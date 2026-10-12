extends RefCounted
## 게임 규칙과 상태. 화면(main.gd)과 분리해 두었다.
## 시간은 step() 한 번에 게임 시간 1분씩 흐른다.

signal changed # 목록이 바뀜 → 화면 다시 그리기
signal logged(line: String) # 업무 일지에 한 줄 추가
signal event_raised # 팀장 이벤트 발생
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

var machines: Array = [] # {id, type, name, status, condition, hidden_damage, unchecked_release, renter}
var reservations: Array = [] # {id, farmer, type, day, unit_id, state(요청/확정/대여중/완료/취소)}
var arrivals: Array = [] # 앞으로 창구에 올 손님 {day, time, kind, res_id}
var counter: Array = [] # 창구에서 기다리는 손님 {id, kind(대여/반납), res_id, farmer, arrive, serving}
var calls: Array = [] # 고장 전화 {id, farmer, village, travel, problem, fix_min, unit_id, machine, state(수신/등록/진행중), expire}
var trip: Dictionary = {} # 진행 중인 출장. phase: 이동 → 현장수리 → 복귀 → 종료대기
var busy: Dictionary = {} # 사업소에서 하는 작업 {kind, label, until, ...}
var events: Array = [] # 대기 중인 팀장 이벤트
var log_lines: Array = []
var day_stats: Dictionary = {}
var day_over := false
var ending := "" # 비어 있지 않으면 게임 끝 (rel / stress / sat / week)
var proposal_used := false

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
	_update_counter()
	_update_calls()
	_random_happenings()
	if minute % 60 == 0:
		apply_fx({"stress": 1})
	if minute % 15 == 0 and waiting_count() >= 3:
		apply_fx({"stress": 2})
	if minute == D.DAY_START + 5:
		_raise_morning_event()
	if minute >= D.DAY_END and busy.is_empty() and trip.is_empty():
		_end_day()


func _update_busy() -> void:
	if busy.is_empty() or minute < int(busy["until"]):
		return
	var task := busy
	busy = {}
	match task["kind"]:
		"release":
			_finish_inspected_release(task)
		"return":
			_finish_return(task["visitor_id"], 1.0)
		"repair":
			_finish_repair(task["unit_id"])
		"service":
			_finish_service(task["unit_id"])
	changed.emit()


func _update_trip() -> void:
	if trip.is_empty() or trip["phase"] == "종료대기" or minute < int(trip["phase_end"]):
		return
	match trip["phase"]:
		"이동":
			trip["phase"] = "현장수리"
			trip["phase_end"] = minute + int(trip["fix_min"])
			add_log("%s 도착. %s 님 %s 현장 수리를 시작합니다." % [trip["village"], trip["farmer"], trip["machine"]])
		"현장수리":
			_finish_field_repair()
			trip["phase"] = "복귀"
			trip["phase_end"] = minute + int(trip["travel"])
		"복귀":
			trip["phase"] = "종료대기"
			trip["return_time"] = minute
			add_log("사업소에 복귀했습니다. [출장 종료]를 눌러주세요.")
	changed.emit()


func _update_arrivals() -> void:
	var remaining: Array = []
	for a in arrivals:
		if a["day"] == day and a["time"] <= minute:
			_add_visitor(a["kind"], a["res_id"])
		else:
			remaining.append(a)
	arrivals = remaining


func _update_counter() -> void:
	for v in counter.duplicate():
		if v["serving"] or minute - int(v["arrive"]) < D.VISITOR_PATIENCE:
			continue
		_remove_visitor(v["id"])
		var res := _res(v["res_id"])
		day_stats["left"] += 1
		if v["kind"] == "대여":
			res["state"] = "취소"
			apply_fx({"sat": -8})
			add_log("%s 님이 기다리다 지쳐 그냥 돌아가셨습니다." % v["farmer"])
		else:
			# 반납 손님은 장비만 마당에 두고 간다 (점검 없이 들어온다)
			apply_fx({"sat": -5})
			add_log("%s 님이 %s 마당에 두고 그냥 가셨습니다. 점검을 못 했습니다." % [v["farmer"], _machine(res["unit_id"]).get("name", "장비")])
			_return_unit(_machine(res["unit_id"]), 0.0)
			res["state"] = "완료"
		_raise_once("complaint")
		changed.emit()


func _update_calls() -> void:
	for c in calls.duplicate():
		if c["state"] == "진행중" or minute < int(c["expire"]):
			continue
		calls.erase(c)
		apply_fx({"sat": -6})
		add_log("%s 님(%s) 고장 전화를 처리하지 못했습니다. 다른 업체를 부르셨답니다." % [c["farmer"], c["village"]])
		_raise_once("missed_call")
		changed.emit()


func _random_happenings() -> void:
	if minute < D.DAY_END - 60 and rng.randf() < D.RESERVATION_REQUEST_CHANCE:
		var target := day + rng.randi_range(1, 2)
		if target <= D.LAST_DAY:
			var res := _make_request(target)
			add_log("예약 요청: %s 님, %s (%s요일)" % [res["farmer"], res["type"], weekday_of(target)])
			changed.emit()
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
	_warned = {}
	day_stats = {"served": 0, "left": 0, "trips": 0, "trip_pay": 0, "repairs": 0}
	for r in reservations:
		if r["day"] == day and r["state"] == "확정":
			arrivals.append({"day": day, "time": rng.randi_range(D.DAY_START + 10, 14 * 60), "kind": "대여", "res_id": r["id"]})
	add_log("──── %d일차 (%s요일) 업무 시작 ────" % [day, weekday_of(day)])
	changed.emit()


func _end_day() -> void:
	for v in counter:
		var res := _res(v["res_id"])
		if v["kind"] == "대여":
			res["state"] = "취소"
		else:
			_return_unit(_machine(res["unit_id"]), 0.0)
			res["state"] = "완료"
		apply_fx({"sat": -4})
	counter.clear()
	apply_fx({"sat": -5 * calls.size()})
	calls.clear()
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
	add_log("──── 퇴근 ────")
	day_over = true
	changed.emit()
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


# ───────────────────────── 플레이어 행동 ─────────────────────────
# 실패하면 이유를 문자열로 돌려준다. 성공하면 "".

func can_act() -> bool:
	return busy.is_empty() and not is_away() and not day_over and ending == ""


func is_away() -> bool:
	return not trip.is_empty() and trip["phase"] != "종료대기"


func assign_reservation(res_id: int) -> String:
	if is_away():
		return "출장 중에는 할 수 없습니다."
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
	changed.emit()
	return ""


func reject_reservation(res_id: int) -> String:
	var res := _res(res_id)
	if res.is_empty() or res["state"] != "요청":
		return "이미 처리된 예약입니다."
	res["state"] = "취소"
	apply_fx({"sat": -3})
	add_log("예약 거절: %s 님, %s" % [res["farmer"], res["type"]])
	changed.emit()
	return ""


func release(visitor_id: int, inspect: bool) -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var v := _visitor(visitor_id)
	if v.is_empty():
		return ""
	var res := _res(v["res_id"])
	var unit := _machine(res["unit_id"])
	if unit.is_empty() or unit["status"] != "대기":
		var alt := _available_unit(res["type"])
		if alt.is_empty():
			return "출고할 수 있는 %s 없습니다. 수리하거나 사과하고 돌려보내세요." % josa(res["type"], "이", "가")
		add_log("%s 대신 %s 출고합니다." % [unit.get("name", "배정 장비"), ro(alt["name"])])
		res["unit_id"] = alt["id"]
		unit = alt
	if inspect:
		v["serving"] = true
		unit["status"] = "점검중"
		busy = {"kind": "release", "label": "%s 출고 점검" % unit["name"], "until": minute + D.INSPECT_RELEASE_MIN,
			"visitor_id": visitor_id, "unit_id": unit["id"]}
		changed.emit()
		return ""
	_do_release(v, res, unit, false)
	return ""


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
	changed.emit()
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
		busy = {"kind": "return", "label": "%s 반납 점검" % unit.get("name", "장비"),
			"until": minute + D.INSPECT_RETURN_MIN, "visitor_id": visitor_id}
		changed.emit()
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
	busy = {"kind": "repair", "label": "%s 수리" % unit["name"], "until": minute + rng.randi_range(r[0], r[1]), "unit_id": unit_id}
	changed.emit()
	return ""


func service(unit_id: int) -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var unit := _machine(unit_id)
	if unit["status"] != "대기":
		return "대기 중인 장비만 정비할 수 있습니다."
	unit["status"] = "정비중"
	busy = {"kind": "service", "label": "%s 정기 정비" % unit["name"], "until": minute + D.SERVICE_MIN, "unit_id": unit_id}
	changed.emit()
	return ""


## 출장 올리기 (전산 등록)
func register_trip(call_id: int) -> String:
	if is_away():
		return "출장 중에는 할 수 없습니다."
	var c := _call(call_id)
	if c.is_empty() or c["state"] != "수신":
		return ""
	c["state"] = "등록"
	c["expire"] = int(c["expire"]) + 60
	add_log("출장 등록: %s %s 님 (%s)" % [c["village"], c["farmer"], c["machine"]])
	if waiting_count() > 0:
		_raise_once("trip_with_queue")
	changed.emit()
	return ""


func depart(call_id: int) -> String:
	if not trip.is_empty():
		return "이전 출장을 먼저 종료하세요."
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	var c := _call(call_id)
	if c.is_empty() or c["state"] != "등록":
		return "출장을 먼저 등록(올리기)해야 합니다."
	c["state"] = "진행중"
	trip = c.duplicate()
	trip["call_id"] = call_id
	trip["start"] = minute
	trip["phase"] = "이동"
	trip["phase_end"] = minute + int(c["travel"])
	add_log("출장 출발 → %s (편도 %d분)" % [c["village"], c["travel"]])
	changed.emit()
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
	changed.emit()
	return ""


## ENTJ 본능: 하루 한 번 업무 개선안을 올린다
func submit_proposal() -> String:
	if not can_act():
		return "지금은 다른 일을 하고 있습니다."
	if proposal_used:
		return "개선안은 하루에 한 번만 올릴 수 있습니다."
	proposal_used = true
	_raise_now("proposal")
	return ""


func choose(option: Dictionary) -> void:
	events.pop_front()
	apply_fx(option["fx"])
	add_log("%s: \"%s\"" % [D.LEADER, option["reply"]])
	changed.emit()


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
		add_log("출고 점검 중 %s 결함을 찾았습니다! 다른 장비로 바꾸거나 수리하세요." % unit["name"])
		if not v.is_empty():
			v["serving"] = false
			v["arrive"] = minute - int(D.VISITOR_PATIENCE / 2.0) # 기다린 시간은 그대로, 조금 더 기다려 주신다
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
	changed.emit()


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
	changed.emit()


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
		add_log("반납 점검: %s 고장을 발견했습니다. 수리가 필요합니다." % unit["name"])
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
	apply_fx({"sat": 5, "perf": 2})
	add_log("현장 수리 완료! %s 님이 고맙다며 음료수를 주셨습니다." % trip["farmer"])


# ───────────────────────── 생성 ─────────────────────────

func _build_machines() -> void:
	for type in D.MACHINE_TYPES:
		var count: int = D.MACHINE_TYPES[type]["count"]
		for i in count:
			machines.append({
				"id": _new_id(), "type": type, "name": "%s %d호" % [type, i + 1],
				"status": "대기", "condition": rng.randi_range(55, 95),
				"hidden_damage": false, "unchecked_release": false, "renter": "",
			})
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
	calls.append({
		"id": _new_id(), "farmer": farmer, "village": village, "travel": D.VILLAGES[village],
		"problem": D.PROBLEMS[rng.randi_range(0, D.PROBLEMS.size() - 1)], "fix_min": rng.randi_range(30, 90),
		"unit_id": unit_id, "machine": machine, "state": "수신", "expire": minute + D.CALL_WAIT,
	})
	add_log("[전화] %s %s 님: %s %s" % [village, farmer, machine, calls[-1]["problem"]])
	if not unit.is_empty() and unit["unchecked_release"]:
		_raise_once("bad_release")
	changed.emit()


func _add_visitor(kind: String, res_id: int) -> void:
	var res := _res(res_id)
	if res.is_empty() or res["state"] == "취소":
		return
	counter.append({"id": _new_id(), "kind": kind, "res_id": res_id, "farmer": res["farmer"], "arrive": minute, "serving": false})
	var what := "빌리러" if kind == "대여" else "반납하러"
	add_log("창구: %s 님이 %s %s 오셨습니다." % [res["farmer"], res["type"], what])
	changed.emit()


func _raise_morning_event() -> void:
	if _morning_pool.is_empty():
		_morning_pool = range(D.MORNING_EVENTS.size())
		_morning_pool.shuffle()
	events.append(D.MORNING_EVENTS[_morning_pool.pop_back()])
	event_raised.emit()


func _raise_now(id: String) -> void:
	events.append(D.TRIGGER_EVENTS[id])
	event_raised.emit()


func _raise_once(id: String) -> void:
	if _warned.has(id):
		return
	_warned[id] = true
	_raise_now(id)


# ───────────────────────── 조회 ─────────────────────────

func waiting_count() -> int:
	var n := 0
	for v in counter:
		if not v["serving"]:
			n += 1
	return n


func pending_requests() -> Array:
	return reservations.filter(func(r): return r["state"] == "요청")


func upcoming_reservations() -> Array:
	return reservations.filter(func(r): return r["state"] == "확정" and r["day"] >= day)


func visitor_patience(v: Dictionary) -> int:
	return D.VISITOR_PATIENCE - (minute - int(v["arrive"]))


func reservation_of(res_id: int) -> Dictionary:
	return _res(res_id)


func machine_of(unit_id: int) -> Dictionary:
	return _machine(unit_id)


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


func _available_unit(type: String) -> Dictionary:
	for m in machines:
		if m["type"] == type and m["status"] == "대기":
			return m
	return {}


func _has_call_for(unit_id: int) -> bool:
	for c in calls:
		if c["unit_id"] == unit_id:
			return true
	return false


func _res(id: int) -> Dictionary:
	for r in reservations:
		if r["id"] == id:
			return r
	return {}


func _visitor(id: int) -> Dictionary:
	for v in counter:
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
	counter = counter.filter(func(v): return v["id"] != id)


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
