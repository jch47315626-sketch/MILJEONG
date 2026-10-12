extends RefCounted
## 게임 규칙과 상태. 화면(world.gd, main.gd)과 분리해 두었다.
## 시간은 step() 한 번에 게임 시간 1분씩 흐른다.
## 플레이어가 어디에 서서 무엇을 눌렀는지는 main.gd가 판단하고, 여기의 행동 함수를 부른다.

signal logged(line: String) # 업무 일지에 한 줄 추가
signal notice(text: String) # 화면에 잠깐 띄울 알림 (전화벨 등)
signal day_finished
signal game_finished

const D = preload("res://scripts/data.gd")
const WEEKDAYS := ["월", "화", "수", "목", "금", "토", "일"]

var rng := RandomNumberGenerator.new()

var day := 1
var minute: int = D.DAY_START
var rel := 50 # 팀장 관계
var stress := 20 # 스트레스
var sat := 60 # 민원 만족도
var perf := 0 # 업무 성과
var money := 0 # 받은 출장비 합계

var machines: Array = [] # {id, type, name, slot, status, condition, hidden_damage, unchecked_release, renter}
var reservations: Array = [] # {id, farmer, type, day, unit_id, state(요청/확정/대여중/완료/취소)}
var arrivals: Array = [] # 앞으로 올 손님 {day, time, kind, res_id}
## 사업소에 와 있는 손님 {id, kind(대여/반납), res_id, farmer, arrive, stage, serving}
## stage: 창구(대여 접수 전) → 출고대기(마당에서 장비 기다림) / 반납대기(마당에서 확인 기다림)
var visitors: Array = []
var ringing: Array = [] # 벨이 울리는 전화 (아직 안 받음)
var calls: Array = [] # 받은 고장 전화 {id, farmer, village, travel, problem, fix_min, unit_id, machine, state(수신/등록/진행중), expire}
## 진행 중인 출장. phase: 이동 → 현장 → 현장수리 → 현장(fixed) → 복귀 → 종료대기
var trip: Dictionary = {}
var busy: Dictionary = {} # 몸이 묶이는 작업 {kind, label, start, until, ...}
var events: Array = [] # 팀장이 할 말 {ev, since, nagged, auto}
var log_lines: Array = []
var day_stats: Dictionary = {}
var day_over := false
var ending := "" # 비어 있지 않으면 게임 끝 (rel / stress / sat / week)
var proposal_used := false
var coffee_count := 0

var _next_id := 1
var _morning_pool: Array = []
var _warned: Dictionary = {} # 하루에 한 번만 터지는 이벤트 기록


func _init() -> void:
	rng.randomize()
	_morning_pool = range(D.MORNING_EVENTS.size())
	_morning_pool.shuffle()
	_build_machines()
	_setup_first_day()


# ───────────────────────── 시간 흐름 ─────────────────────────

func step() -> void:
	if day_over or ending != "":
		return
	minute += 1
	_update_busy()
	_update_trip()
	_update_arrivals()
	_update_visitors()
	_update_phone()
	_update_calls()
	_update_leader()
	_random_happenings()
	if minute % 60 == 0:
		apply_fx({"stress": 1})
	if minute % 15 == 0 and waiting_count() >= 3:
		apply_fx({"stress": 2})
	if minute >= D.DAY_END and busy.is_empty() and trip.is_empty():
		_end_day()


func _update_busy() -> void:
	if busy.is_empty() or minute < int(busy["until"]):
		return
	var task := busy
	busy = {}
	match task["kind"]:
		"accept":
			_finish_accept(task["visitor_id"])
		"release":
			_finish_inspected_release(task)
		"return":
			_finish_return(task["visitor_id"], 1.0)
		"repair":
			_finish_repair(task["unit_id"])
		"service":
			_finish_service(task["unit_id"])
		"coffee":
			apply_fx({"stress": -6})
			add_log("커피 한 잔으로 숨을 돌렸습니다.")
		"field":
			_finish_field_repair()


func _update_trip() -> void:
	if trip.is_empty() or not trip.has("phase_end") or minute < int(trip["phase_end"]):
		return
	match trip["phase"]:
		"이동":
			trip["phase"] = "현장"
			trip.erase("phase_end")
			add_log("%s 도착. %s 님을 찾아가세요." % [trip["village"], trip["farmer"]])
		"복귀":
			trip["phase"] = "종료대기"
			trip["return_time"] = minute
			trip.erase("phase_end")
			add_log("사업소에 복귀했습니다. 컴퓨터에서 [출장 종료]를 눌러주세요.")
			notice.emit("복귀 완료! 컴퓨터에서 출장 종료를 누르세요.")


func _update_arrivals() -> void:
	var remaining: Array = []
	for a in arrivals:
		if a["day"] == day and a["time"] <= minute:
			_add_visitor(a["kind"], a["res_id"])
		else:
			remaining.append(a)
	arrivals = remaining


func _update_visitors() -> void:
	for v in visitors.duplicate():
		if v["serving"] or minute - int(v["arrive"]) < D.VISITOR_PATIENCE:
			continue
		_remove_visitor(v["id"])
		var res := _res(v["res_id"])
		day_stats["left"] += 1
		if v["kind"] == "대여":
			res["state"] = "취소"
			apply_fx({"sat": -8})
			add_log("%s 님이 기다리다 지쳐 그냥 돌아가셨습니다." % v["farmer"])
			notice.emit("%s 님이 화가 나서 돌아가셨습니다." % v["farmer"])
		else:
			# 반납 손님은 장비만 두고 간다 (점검 없이 창고로 들어간다)
			apply_fx({"sat": -5})
			add_log("%s 님이 장비를 두고 그냥 가셨습니다. 점검을 못 했습니다." % v["farmer"])
			_return_unit(_machine(res["unit_id"]), 0.0)
			res["state"] = "완료"
		_raise_once("complaint")


func _update_phone() -> void:
	for c in ringing.duplicate():
		if minute < int(c["ring_end"]):
			continue
		ringing.erase(c)
		apply_fx({"sat": -4})
		add_log("전화를 못 받았습니다. (%s 님)" % c["farmer"])


func _update_calls() -> void:
	for c in calls.duplicate():
		if c["state"] == "진행중" or minute < int(c["expire"]):
			continue
		calls.erase(c)
		apply_fx({"sat": -6})
		add_log("%s 님(%s) 출장을 못 가서 다른 업체를 부르셨답니다." % [c["farmer"], c["village"]])
		_raise_once("missed_call")


func _update_leader() -> void:
	if is_away():
		return
	for e in events:
		if e["auto"] or e["nagged"] or minute - int(e["since"]) < D.LEADER_NAG_MIN:
			continue
		e["nagged"] = true
		apply_fx({"rel": -3})
		notice.emit("%s이 부르는데 안 오냐고 화가 났습니다. (관계 -3)" % D.LEADER)


func _random_happenings() -> void:
	if minute < D.DAY_END - 60 and rng.randf() < D.RESERVATION_REQUEST_CHANCE:
		var target := day + rng.randi_range(1, 2)
		if target <= D.LAST_DAY:
			var res := _make_request(target)
			add_log("예약 요청: %s 님, %s (%s요일)" % [res["farmer"], res["type"], weekday_of(target)])
	if minute >= D.CALL_CUTOFF:
		return
	if rng.randf() < D.FIELD_CALL_CHANCE:
		_new_call(-1)
	for m in machines:
		if m["status"] != "임대중" or _has_call_for(m["id"]):
			continue
		if (m["hidden_damage"] or int(m["condition"]) < 40) and rng.randf() < D.RENTED_BREAKDOWN_CHANCE:
			_new_call(m["id"])


# ───────────────────────── 하루 시작과 끝 ─────────────────────────

func _setup_first_day() -> void:
	for i in 3:
		var res := _make_request(1)
		var unit := _find_assignable(res["type"], 1)
		if not unit.is_empty():
			res["unit_id"] = unit["id"]
			res["state"] = "확정"
	for i in 2:
		_make_request(2)
	_start_day()


func _start_day() -> void:
	minute = D.DAY_START
	day_over = false
	proposal_used = false
	coffee_count = 0
	_warned = {}
	day_stats = {"served": 0, "left": 0, "trips": 0, "trip_pay": 0, "repairs": 0}
	for r in reservations:
		if r["day"] == day and r["state"] == "확정":
			arrivals.append({"day": day, "time": rng.randi_range(D.DAY_START + 10, 14 * 60), "kind": "대여", "res_id": r["id"]})
	add_log("──── %d일차 (%s요일) 업무 시작 ────" % [day, weekday_of(day)])
	_queue_morning_event()


func _end_day() -> void:
	for v in visitors:
		var res := _res(v["res_id"])
		if v["kind"] == "대여":
			res["state"] = "취소"
		else:
			_return_unit(_machine(res["unit_id"]), 0.0)
			res["state"] = "완료"
		apply_fx({"sat": -4})
	visitors.clear()
	apply_fx({"sat": -5 * calls.size()})
	calls.clear()
	ringing.clear()
	# 퇴근 직전에 확정해서 오늘 못 온 손님: 대여는 취소, 반납은 내일 아침으로
	for a in arrivals:
		if a["day"] != day:
			continue
		if a["kind"] == "대여":
			_res(a["res_id"])["state"] = "취소"
		else:
			a["day"] = day + 1
			a["time"] = rng.randi_range(D.DAY_START + 5, D.DAY_START + 90)
	arrivals = arrivals.filter(func(a): return a["day"] != day)
	for r in reservations:
		if r["state"] == "요청" and r["day"] <= day + 1:
			# 내일 예약까지는 오늘 확정해 줘야 한다
			r["state"] = "취소"
			apply_fx({"sat": -3})
			add_log("%s 님 예약 요청을 처리하지 않아 취소됐습니다." % r["farmer"])
	# 못 들은 팀장 잔소리는 내일로 넘어가지 않는다
	events.clear()
	add_log("──── 퇴근 ────")
	day_over = true
	if ending == "":
		day_finished.emit()


func next_day() -> void:
	if day >= D.LAST_DAY:
		ending = "week"
		game_finished.emit()
		return
	day += 1
	apply_fx({"stress": -12})
	_start_day()


# ───────────────────────── 상태 조회 ─────────────────────────

func can_act() -> bool:
	return busy.is_empty() and location() != "driving" and not day_over and ending == ""


func is_away() -> bool:
	return not trip.is_empty() and trip["phase"] != "종료대기"


## office(사업소) / village(출장 현장) / driving(트럭 이동 중)
func location() -> String:
	if trip.is_empty():
		return "office"
	match trip["phase"]:
		"이동", "복귀":
			return "driving"
		"현장", "현장수리":
			return "village"
	return "office"


func visitors_at(stage: String) -> Array:
	return visitors.filter(func(v): return v["stage"] == stage)


func waiting_count() -> int:
	var n := 0
	for v in visitors:
		if not v["serving"]:
			n += 1
	return n


func pending_requests() -> Array:
	return reservations.filter(func(r): return r["state"] == "요청")


func upcoming_reservations() -> Array:
	return reservations.filter(func(r): return r["state"] == "확정" and r["day"] >= day)


func calls_in(call_state: String) -> Array:
	return calls.filter(func(c): return c["state"] == call_state)


func broken_count() -> int:
	return machines.filter(func(m): return m["status"] == "고장").size()


func visitor_patience(v: Dictionary) -> int:
	return D.VISITOR_PATIENCE - (minute - int(v["arrive"]))


## 이 장비를 받으려고 마당에서 기다리는 손님
func pickup_visitor_for(unit_id: int) -> Dictionary:
	for v in visitors:
		if v["stage"] == "출고대기" and _res(v["res_id"]).get("unit_id", -1) == unit_id:
			return v
	return {}


## 마당 반납 자리에 서 있는 장비면 그 손님을 돌려준다
func return_visitor_for(unit_id: int) -> Dictionary:
	for v in visitors:
		if v["stage"] == "반납대기" and _res(v["res_id"]).get("unit_id", -1) == unit_id:
			return v
	return {}


func reservation_of(res_id: int) -> Dictionary:
	return _res(res_id)


func machine_of(unit_id: int) -> Dictionary:
	return _machine(unit_id)


func visitor_of(visitor_id: int) -> Dictionary:
	return _visitor(visitor_id)


func busy_progress() -> float:
	if busy.is_empty():
		return 0.0
	var total := maxi(1, int(busy["until"]) - int(busy["start"]))
	return clampf(float(minute - int(busy["start"])) / total, 0.0, 1.0)


func drive_progress() -> float:
	if location() != "driving":
		return 0.0
	var total := maxi(1, int(trip["travel"]))
	return clampf(1.0 - float(int(trip["phase_end"]) - minute) / total, 0.0, 1.0)


# ───────────────────────── 플레이어 행동 ─────────────────────────
# 실패하면 이유를 문자열로 돌려준다. 성공하면 "".

func _start_busy(kind: String, label: String, minutes: int, data := {}) -> void:
	busy = data.duplicate()
	busy["kind"] = kind
	busy["label"] = label
	busy["start"] = minute
	busy["until"] = minute + minutes


## 창구에서 대여 접수. 배정 장비를 못 쓰면 같은 종류로 바꿔 준다.
## 돌려주는 값: {ok, text}
func accept_rental(visitor_id: int) -> Dictionary:
	if not can_act():
		return {"ok": false, "text": "지금은 다른 일을 하고 있습니다."}
	var v := _visitor(visitor_id)
	if v.is_empty():
		return {"ok": false, "text": ""}
	var res := _res(v["res_id"])
	var unit := _machine(res["unit_id"])
	var text := ""
	if unit.is_empty() or unit["status"] != "대기" or not pickup_visitor_for(unit["id"]).is_empty():
		var alt := _available_unit(res["type"])
		if alt.is_empty():
			return {"ok": false, "text": "지금 내드릴 수 있는 %s 없습니다." % josa(res["type"], "이", "가")}
		text = "배정했던 %s 쓸 수 없어 %s 바꿨습니다.\n" % [josa(unit.get("name", "장비"), "을", "를"), ro(alt["name"])]
		res["unit_id"] = alt["id"]
		unit = alt
	v["serving"] = true
	_start_busy("accept", "%s 님 대여 접수" % v["farmer"], D.ACCEPT_MIN, {"visitor_id": visitor_id})
	return {"ok": true, "text": text + "창고에서 %s 꺼내 주세요. 손님은 마당에서 기다립니다." % josa(unit["name"], "을", "를")}


func _finish_accept(visitor_id: int) -> void:
	var v := _visitor(visitor_id)
	if v.is_empty():
		return
	v["serving"] = false
	v["stage"] = "출고대기"
	v["arrive"] = minute # 마당에서 새로 기다리기 시작
	add_log("대여 접수: %s 님 → %s" % [v["farmer"], _machine(_res(v["res_id"])["unit_id"]).get("name", "")])


func apologize(visitor_id: int) -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var v := _visitor(visitor_id)
	if v.is_empty():
		return ""
	_res(v["res_id"])["state"] = "취소"
	_remove_visitor(visitor_id)
	apply_fx({"sat": -6})
	add_log("%s 님께 사과드리고 돌려보냈습니다." % v["farmer"])
	return ""


## 창고에서 장비를 꺼내 마당의 손님에게 넘긴다
func release_machine(unit_id: int, inspect: bool) -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var v := pickup_visitor_for(unit_id)
	var unit := _machine(unit_id)
	if v.is_empty() or unit.is_empty():
		return "이 장비를 기다리는 손님이 없습니다."
	if unit["status"] != "대기":
		return "%s 출고할 수 없는 상태입니다. (%s)" % [josa(unit["name"], "은", "는"), unit["status"]]
	if inspect:
		v["serving"] = true
		unit["status"] = "점검중"
		_start_busy("release", "%s 출고 점검" % unit["name"], D.INSPECT_RELEASE_MIN, {"visitor_id": v["id"], "unit_id": unit_id})
		return ""
	_do_release(v, _res(v["res_id"]), unit, false)
	return ""


func receive_return(visitor_id: int, thorough: bool) -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var v := _visitor(visitor_id)
	if v.is_empty():
		return ""
	if thorough:
		v["serving"] = true
		var unit := _machine(_res(v["res_id"])["unit_id"])
		_start_busy("return", "%s 반납 점검" % unit.get("name", "장비"), D.INSPECT_RETURN_MIN, {"visitor_id": visitor_id})
		return ""
	_finish_return(visitor_id, 0.5)
	return ""


func repair(unit_id: int) -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var unit := _machine(unit_id)
	if unit["status"] != "고장":
		return "고장 난 장비가 아닙니다."
	var r: Array = D.MACHINE_TYPES[unit["type"]]["repair"]
	unit["status"] = "정비중"
	_start_busy("repair", "%s 수리" % unit["name"], rng.randi_range(r[0], r[1]), {"unit_id": unit_id})
	return ""


func service(unit_id: int) -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var unit := _machine(unit_id)
	if unit["status"] != "대기":
		return "대기 중인 장비만 정비할 수 있습니다."
	unit["status"] = "정비중"
	_start_busy("service", "%s 정기 정비" % unit["name"], D.SERVICE_MIN, {"unit_id": unit_id})
	return ""


func coffee() -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	if coffee_count >= D.COFFEE_PER_DAY:
		return "오늘은 커피를 너무 많이 마셨습니다."
	coffee_count += 1
	_start_busy("coffee", "커피 한 잔", D.COFFEE_MIN)
	return ""


## 울리는 전화를 받는다. 받은 전화를 돌려준다 (없으면 빈 Dictionary)
func answer_phone() -> Dictionary:
	if ringing.is_empty():
		return {}
	var c: Dictionary = ringing.pop_front()
	c.erase("ring_end")
	c["state"] = "수신"
	c["expire"] = minute + D.CALL_WAIT
	calls.append(c)
	add_log("[전화] %s %s 님: %s %s" % [c["village"], c["farmer"], c["machine"], c["problem"]])
	var unit := _machine(c["unit_id"])
	if not unit.is_empty() and unit["unchecked_release"]:
		_raise_once("bad_release")
	return c


func assign_reservation(res_id: int) -> String:
	var res := _res(res_id)
	if res.is_empty() or res["state"] != "요청":
		return "이미 처리된 예약입니다."
	var unit := _find_assignable(res["type"], res["day"])
	if unit.is_empty():
		return "%s요일에 배정할 수 있는 %s 없습니다." % [weekday_of(res["day"]), josa(res["type"], "이", "가")]
	res["unit_id"] = unit["id"]
	res["state"] = "확정"
	apply_fx({"perf": 1})
	add_log("예약 확정: %s 님, %s (%s요일)" % [res["farmer"], unit["name"], weekday_of(res["day"])])
	if res["day"] == day:
		arrivals.append({"day": day, "time": minute + rng.randi_range(20, 60), "kind": "대여", "res_id": res["id"]})
	return ""


func reject_reservation(res_id: int) -> String:
	var res := _res(res_id)
	if res.is_empty() or res["state"] != "요청":
		return "이미 처리된 예약입니다."
	res["state"] = "취소"
	apply_fx({"sat": -3})
	add_log("예약 거절: %s 님, %s" % [res["farmer"], res["type"]])
	return ""


## 출장 올리기 (컴퓨터에서 전산 등록)
func register_trip(call_id: int) -> String:
	var c := _call(call_id)
	if c.is_empty() or c["state"] != "수신":
		return ""
	c["state"] = "등록"
	c["expire"] = int(c["expire"]) + 60
	add_log("출장 등록: %s %s 님 (%s)" % [c["village"], c["farmer"], c["machine"]])
	if waiting_count() > 0:
		_raise_once("trip_with_queue")
	return ""


## 트럭을 타고 출발
func depart(call_id: int) -> String:
	if not trip.is_empty():
		return "이전 출장을 먼저 종료하세요."
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var c := _call(call_id)
	if c.is_empty() or c["state"] != "등록":
		return "출장을 먼저 컴퓨터에서 올려야 합니다."
	c["state"] = "진행중"
	trip = c.duplicate()
	trip["call_id"] = call_id
	trip["start"] = minute
	trip["phase"] = "이동"
	trip["phase_end"] = minute + int(c["travel"])
	trip["fixed"] = false
	add_log("출장 출발 → %s (편도 %d분)" % [c["village"], c["travel"]])
	return ""


func start_field_repair() -> String:
	if trip.is_empty() or trip["phase"] != "현장" or trip["fixed"]:
		return ""
	if not busy.is_empty():
		return "지금은 다른 일을 하고 있습니다."
	trip["phase"] = "현장수리"
	_start_busy("field", "%s 님 %s 현장 수리" % [trip["farmer"], trip["machine"]], int(trip["fix_min"]))
	return ""


func leave_village() -> String:
	if trip.is_empty() or trip["phase"] != "현장":
		return ""
	if not trip["fixed"]:
		calls.erase(_call(trip["call_id"]))
		apply_fx({"sat": -8})
		add_log("수리를 못 하고 돌아갑니다. %s 님이 실망하셨습니다." % trip["farmer"])
	trip["phase"] = "복귀"
	trip["phase_end"] = minute + int(trip["travel"])
	return ""


func end_trip() -> String:
	if trip.is_empty() or trip["phase"] != "종료대기":
		return "아직 복귀하지 않았습니다."
	var duration: int = minute - int(trip["start"])
	var late: int = minute - int(trip["return_time"])
	var pay: int = D.TRIP_PAY if duration >= D.TRIP_PAY_MINUTES else 0
	var line := "출장 종료: %s ~ %s (%s)" % [fmt_time(trip["start"]), fmt_time(minute), fmt_duration(duration)]
	if late > D.PADDING_GRACE and rng.randf() < D.PADDING_CATCH_CHANCE:
		pay = 0
		line += " → 늦게 누른 게 걸려 출장비 없음"
		_raise_now("padding")
	elif pay > 0:
		line += " → 출장비 %s원" % comma(pay)
	else:
		line += " → 2시간 미만, 무급"
	money += pay
	day_stats["trips"] += 1
	day_stats["trip_pay"] += pay
	trip = {}
	add_log(line)
	return line


## ENTJ 본능: 하루 한 번 업무 개선안을 올린다
func submit_proposal() -> String:
	if proposal_used:
		return "개선안은 하루에 한 번만 올릴 수 있습니다."
	proposal_used = true
	_raise_now("proposal")
	return ""


func leader_has_words() -> bool:
	return not events.is_empty()


func choose(option: Dictionary) -> void:
	events.pop_front()
	apply_fx(option["fx"])
	add_log("%s: \"%s\"" % [D.LEADER, option["reply"]])


func apply_fx(fx: Dictionary) -> void:
	rel = clampi(rel + int(fx.get("rel", 0)), 0, 100)
	stress = clampi(stress + int(fx.get("stress", 0)), 0, 100)
	sat = clampi(sat + int(fx.get("sat", 0)), 0, 100)
	perf += int(fx.get("perf", 0))
	if ending != "":
		return
	if rel <= 0:
		ending = "rel"
	elif stress >= 100:
		ending = "stress"
	elif sat <= 0:
		ending = "sat"
	if ending != "":
		game_finished.emit()


# ───────────────────────── 작업 완료 처리 ─────────────────────────

func _finish_inspected_release(task: Dictionary) -> void:
	var v := _visitor(task["visitor_id"])
	var unit := _machine(task["unit_id"])
	if unit["hidden_damage"]:
		unit["status"] = "고장"
		unit["hidden_damage"] = false
		apply_fx({"perf": 2})
		add_log("출고 점검 중 %s 결함을 찾았습니다!" % unit["name"])
		notice.emit("점검 중 결함 발견! 수리하거나 창구에서 다른 장비로 접수하세요.")
		if not v.is_empty():
			# 다시 창구로 돌아가 다른 장비로 접수를 기다린다
			v["serving"] = false
			v["stage"] = "창구"
			v["arrive"] = minute - int(D.VISITOR_PATIENCE / 2.0)
		return
	unit["status"] = "대기"
	if not v.is_empty():
		_do_release(v, _res(v["res_id"]), unit, true)


func _do_release(v: Dictionary, res: Dictionary, unit: Dictionary, checked: bool) -> void:
	unit["status"] = "임대중"
	unit["renter"] = res["farmer"]
	unit["unchecked_release"] = not checked
	res["state"] = "대여중"
	_remove_visitor(v["id"])
	var back_day := day
	var back := minute + rng.randi_range(180, 360)
	if back > D.DAY_END - 30:
		back_day = day + 1
		back = rng.randi_range(D.DAY_START + 5, D.DAY_START + 90)
	arrivals.append({"day": back_day, "time": back, "kind": "반납", "res_id": res["id"]})
	day_stats["served"] += 1
	apply_fx({"sat": 2, "perf": 1})
	add_log("출고: %s → %s 님%s" % [unit["name"], res["farmer"], "" if checked else " (점검 생략)"])


func _finish_return(visitor_id: int, detect_chance: float) -> void:
	var v := _visitor(visitor_id)
	if v.is_empty():
		return
	var res := _res(v["res_id"])
	_return_unit(_machine(res["unit_id"]), detect_chance)
	res["state"] = "완료"
	_remove_visitor(visitor_id)
	day_stats["served"] += 1
	apply_fx({"perf": 1})


## 반납된 장비 상태를 정한다. detect_chance: 고장을 알아챌 확률
func _return_unit(unit: Dictionary, detect_chance: float) -> void:
	if unit.is_empty():
		return
	unit["condition"] = maxi(5, int(unit["condition"]) - rng.randi_range(5, 20))
	unit["renter"] = ""
	unit["unchecked_release"] = false
	var damage_chance := 0.25 if int(unit["condition"]) >= 40 else 0.5
	var damaged: bool = unit["hidden_damage"] or rng.randf() < damage_chance
	unit["hidden_damage"] = false
	unit["status"] = "대기"
	if not damaged:
		add_log("반납 완료: %s (상태 %d%%)" % [unit["name"], unit["condition"]])
	elif rng.randf() < detect_chance:
		unit["status"] = "고장"
		apply_fx({"perf": 1})
		add_log("반납 점검: %s 고장을 발견했습니다. 창고에서 수리하세요." % unit["name"])
		notice.emit("%s 고장 발견! 창고에서 수리가 필요합니다." % unit["name"])
	else:
		unit["hidden_damage"] = true # 아무도 모르는 결함. 다음 임대 때 터진다
		add_log("반납 완료: %s (상태 %d%%)" % [unit["name"], unit["condition"]])


func _finish_repair(unit_id: int) -> void:
	var unit := _machine(unit_id)
	unit["status"] = "대기"
	unit["hidden_damage"] = false
	unit["condition"] = maxi(int(unit["condition"]), 75)
	day_stats["repairs"] += 1
	apply_fx({"perf": 2})
	add_log("수리 완료: %s" % unit["name"])


func _finish_service(unit_id: int) -> void:
	var unit := _machine(unit_id)
	if unit["hidden_damage"]:
		unit["status"] = "고장"
		unit["hidden_damage"] = false
		apply_fx({"perf": 2})
		add_log("정비 중 %s 숨은 결함을 찾았습니다! 수리가 필요합니다." % unit["name"])
		notice.emit("정비 중 숨은 결함 발견! 수리가 필요합니다.")
		return
	unit["status"] = "대기"
	unit["condition"] = 100
	apply_fx({"perf": 1})
	add_log("정기 정비 완료: %s (상태 100%%)" % unit["name"])


func _finish_field_repair() -> void:
	calls.erase(_call(trip["call_id"]))
	var unit := _machine(trip["unit_id"])
	if not unit.is_empty():
		unit["hidden_damage"] = false
		unit["condition"] = maxi(int(unit["condition"]), 60)
	trip["phase"] = "현장"
	trip["fixed"] = true
	day_stats["repairs"] += 1
	apply_fx({"sat": 5, "perf": 2})
	add_log("현장 수리 완료! %s 님이 고맙다며 음료수를 주셨습니다." % trip["farmer"])


# ───────────────────────── 생성 ─────────────────────────

func _build_machines() -> void:
	var slot := 0
	for type in D.MACHINE_TYPES:
		var count: int = D.MACHINE_TYPES[type]["count"]
		for i in count:
			machines.append({
				"id": _new_id(), "type": type, "name": "%s %d호" % [type, i + 1], "slot": slot,
				"status": "대기", "condition": rng.randi_range(55, 95),
				"hidden_damage": false, "unchecked_release": false, "renter": "",
			})
			slot += 1
	# 처음부터 숨은 결함이 있는 장비가 하나 있다
	machines[rng.randi_range(0, machines.size() - 1)]["hidden_damage"] = true


func _make_request(for_day: int) -> Dictionary:
	var res := {
		"id": _new_id(), "farmer": _random_farmer(),
		"type": machines[rng.randi_range(0, machines.size() - 1)]["type"], # 많은 종류일수록 자주 나온다
		"day": for_day, "unit_id": -1, "state": "요청",
	}
	reservations.append(res)
	return res


func _new_call(unit_id: int) -> void:
	var villages: Array = D.VILLAGES.keys()
	var village: String = villages[rng.randi_range(0, villages.size() - 1)]
	var farmer := _random_farmer()
	var machine := "개인 농기계"
	var unit := _machine(unit_id)
	if not unit.is_empty():
		farmer = unit["renter"]
		machine = "%s(임대)" % unit["name"]
	ringing.append({
		"id": _new_id(), "farmer": farmer, "village": village, "travel": D.VILLAGES[village],
		"problem": D.PROBLEMS[rng.randi_range(0, D.PROBLEMS.size() - 1)], "fix_min": rng.randi_range(30, 90),
		"unit_id": unit_id, "machine": machine, "ring_end": minute + D.RING_MIN,
	})
	notice.emit("따르릉! 사무실 전화가 울립니다.")


func _add_visitor(kind: String, res_id: int) -> void:
	var res := _res(res_id)
	if res.is_empty() or res["state"] == "취소":
		return
	var stage := "창구" if kind == "대여" else "반납대기"
	visitors.append({"id": _new_id(), "kind": kind, "res_id": res_id, "farmer": res["farmer"],
		"arrive": minute, "stage": stage, "serving": false})
	if kind == "대여":
		add_log("창구: %s 님이 %s 빌리러 오셨습니다." % [res["farmer"], res["type"]])
		notice.emit("창구에 손님이 오셨습니다.")
	else:
		add_log("마당: %s 님이 %s 반납하러 오셨습니다." % [res["farmer"], res["type"]])
		notice.emit("마당에 반납 손님이 오셨습니다.")


func _queue_morning_event() -> void:
	if _morning_pool.is_empty():
		_morning_pool = range(D.MORNING_EVENTS.size())
		_morning_pool.shuffle()
	events.append({"ev": D.MORNING_EVENTS[_morning_pool.pop_back()], "since": minute, "nagged": true, "auto": true})


func _raise_now(id: String) -> void:
	events.append({"ev": D.TRIGGER_EVENTS[id], "since": minute, "nagged": false, "auto": false})
	if id != "proposal":
		notice.emit("%s이 찾습니다. 팀장 자리로 가 보세요." % D.LEADER)


func _raise_once(id: String) -> void:
	if _warned.has(id):
		return
	_warned[id] = true
	_raise_now(id)


func add_log(text: String) -> void:
	var line := "[%s] %s" % [fmt_time(minute), text]
	log_lines.append(line)
	logged.emit(line)


func _find_assignable(type: String, for_day: int) -> Dictionary:
	for m in machines:
		if m["type"] != type:
			continue
		var taken := false
		for r in reservations:
			if r["unit_id"] == m["id"] and r["day"] == for_day and (r["state"] == "확정" or r["state"] == "대여중"):
				taken = true
				break
		if not taken:
			return m
	return {}


## 지금 바로 내줄 수 있는 장비 (대기 중이고 다른 손님이 기다리는 장비가 아닌 것)
func _available_unit(type: String) -> Dictionary:
	for m in machines:
		if m["type"] == type and m["status"] == "대기" and pickup_visitor_for(m["id"]).is_empty():
			return m
	return {}


func _has_call_for(unit_id: int) -> bool:
	for c in calls + ringing:
		if c["unit_id"] == unit_id:
			return true
	return false


func _res(id: int) -> Dictionary:
	for r in reservations:
		if r["id"] == id:
			return r
	return {}


func _visitor(id: int) -> Dictionary:
	for v in visitors:
		if v["id"] == id:
			return v
	return {}


func _machine(id: int) -> Dictionary:
	for m in machines:
		if m["id"] == id:
			return m
	return {}


func _call(id: int) -> Dictionary:
	for c in calls:
		if c["id"] == id:
			return c
	return {}


func _remove_visitor(id: int) -> void:
	visitors = visitors.filter(func(v): return v["id"] != id)


func _random_farmer() -> String:
	return D.FARMERS[rng.randi_range(0, D.FARMERS.size() - 1)]


func _new_id() -> int:
	_next_id += 1
	return _next_id


# ───────────────────────── 글자 도우미 ─────────────────────────

static func weekday_of(d: int) -> String:
	return WEEKDAYS[(d - 1) % WEEKDAYS.size()]


static func fmt_time(m: int) -> String:
	return "%02d:%02d" % [floori(m / 60.0), m % 60]


static func fmt_duration(m: int) -> String:
	if m < 60:
		return "%d분" % m
	return "%d시간 %d분" % [floori(m / 60.0), m % 60]


static func comma(n: int) -> String:
	var s := str(n)
	var out := ""
	for i in s.length():
		if i > 0 and (s.length() - i) % 3 == 0:
			out += ","
		out += s[i]
	return out


## 받침에 따라 조사를 붙인다. josa("트랙터", "이", "가") → "트랙터가"
static func josa(word: String, with_final: String, without_final: String) -> String:
	return word + (with_final if _final_consonant(word) > 0 else without_final)


## (으)로
static func ro(word: String) -> String:
	var f := _final_consonant(word)
	return word + ("으로" if f > 0 and f != 8 else "로")


static func _final_consonant(word: String) -> int:
	if word.is_empty():
		return 0
	var c := word.unicode_at(word.length() - 1)
	if c < 0xAC00 or c > 0xD7A3:
		return 0
	return (c - 0xAC00) % 28
