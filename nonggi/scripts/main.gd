extends Node
## 게임 진행, 대화창, 화면 위 정보(HUD).
## 지도와 걷기는 world.gd, 게임 규칙은 game_state.gd에 있다.
##
## 조작: 방향키/WASD 이동, Space·Enter·Z 상호작용, Esc 닫기, Tab 업무 일지

const D = preload("res://scripts/data.gd")
const GameState = preload("res://scripts/game_state.gd")
const World = preload("res://scripts/world.gd")

const MIN_PER_SEC := 1.0 # 걸어 다닐 때: 현실 1초 = 게임 1분 (하루 약 9분)
const FAST_MIN_PER_SEC := 15.0 # 작업 중이거나 트럭 이동 중에는 시간이 빨리 간다

const C_PANEL := Color("fbf7ee")
const C_TEXT := Color("2d2a26")
const C_SUB := Color("7a7166")
const C_LINE := Color("3d362e")
const C_ACCENT := Color("4f7a3a")
const C_RED := Color("b4443a")

const LEADER_SMALL_TALK := [
	"뭐 할 말 있어?",
	"바쁜데 왜.",
	"창구 비워 두지 말고.",
	"요즘 신규들은 말이 많아.",
	"점검표는 다 썼고?",
]

var state: GameState
var world: World
var _acc := 0.0
var _last_location := ""
var _summary_shown := false
var _ending_shown := false

var _font: Font
var _bold: Font
var ui: Control
var status_label: Label
var stats_label: Label
var todo_label: Label
var hint_label: Label
var toast_label: Label
var _toast_tween: Tween
var busy_panel: PanelContainer
var busy_label: Label
var busy_bar: ProgressBar
var drive_overlay: ColorRect
var drive_label: Label
var drive_bar: ProgressBar
var log_panel: PanelContainer
var log_box: RichTextLabel
var dialog: PanelContainer
var dialog_speaker: Label
var dialog_text: Label
var dialog_options: VBoxContainer
var _dialog_open := false
var _dialog_cancel := true


func _ready() -> void:
	_setup_input()
	_load_fonts()
	world = World.new()
	world.font = _font
	world.interacted.connect(_on_interact)
	add_child(world)
	var layer := CanvasLayer.new()
	add_child(layer)
	_build_ui(layer)
	_new_game()


func _new_game() -> void:
	state = GameState.new()
	state.logged.connect(_on_logged)
	state.notice.connect(_toast)
	world.state = state
	world.load_office(D.OFFICE_SPAWN)
	log_box.clear()
	for line in state.log_lines:
		_on_logged(line)
	_acc = 0.0
	_last_location = "office"
	_summary_shown = false
	_ending_shown = false
	close_dialog()


# ───────────────────────── 시간 흐름 ─────────────────────────

func _process(delta: float) -> void:
	if state == null:
		return
	var loc := state.location()
	if loc != _last_location:
		_on_location_changed(loc)
	var playing := not _dialog_open and not state.day_over and state.ending == ""
	world.input_enabled = playing and state.busy.is_empty() and loc != "driving"
	if playing:
		var fast := not state.busy.is_empty() or loc == "driving"
		_acc += delta * (FAST_MIN_PER_SEC if fast else MIN_PER_SEC)
		while _acc >= 1.0:
			_acc -= 1.0
			state.step()
			if _dialog_open or state.day_over or state.ending != "" or state.location() != loc:
				_acc = 0.0
				break
	if not _dialog_open:
		if state.ending != "" and not _ending_shown:
			_show_ending()
		elif state.day_over and not _summary_shown and state.ending == "":
			_show_day_summary()
		elif not state.events.is_empty() and state.events[0]["auto"] and state.location() == "office":
			_leader_event() # 아침 회의는 출근하자마자 시작
	_update_hud()


func _on_location_changed(loc: String) -> void:
	match loc:
		"village":
			world.load_village(state.trip["village"], D.VILLAGE_SPAWN)
		"office":
			if _last_location == "driving":
				world.load_office(D.TRUCK_SIDE)
	_last_location = loc


# ───────────────────────── 상호작용 ─────────────────────────

func _on_interact(target: Dictionary) -> void:
	if _dialog_open or not state.busy.is_empty():
		return
	match target["type"]:
		"counter":
			_talk_counter()
		"visitor":
			_talk_visitor(target["id"])
		"machine":
			_machine_menu(target["id"])
		"pc":
			_pc_menu()
		"phone":
			_phone()
		"leader":
			_talk_leader()
		"desk":
			_desk()
		"truck":
			_truck()
		"sign":
			if world.map_kind == "village":
				say("", "[%s] 마을 안내판. 사업소까지 트럭으로 %d분." % [world.village_name, D.VILLAGES.get(world.village_name, 0)])
			else:
				say("", D.SIGN_TEXT)
		"cabinet":
			say("", "서류가 빼곡하다. 작년 임대 대장도 여기 있다.")
		"house":
			say("", "%s 님 댁이다. 마당에 강아지가 짖는다." % state.trip.get("farmer", ""))
		"job_machine", "job_farmer":
			_field_job()


func _talk_counter() -> void:
	var queue := state.visitors_at("창구")
	if queue.is_empty():
		say("", "창구에 기다리는 손님이 없습니다.")
		return
	_counter_visitor(queue[0])


func _counter_visitor(v: Dictionary) -> void:
	var res := state.reservation_of(v["res_id"])
	var vid: int = v["id"]
	say(v["farmer"], "%s 빌리러 왔어요. %s요일로 예약했는데요." % [res["type"], GameState.weekday_of(res["day"])], [
		["대여 접수하기 (%d분)" % D.ACCEPT_MIN, func(): _accept(vid)],
		["사과하고 돌려보내기", func(): _act(state.apologize(vid))],
	])


func _accept(vid: int) -> void:
	var v := state.visitor_of(vid)
	var r := state.accept_rental(vid)
	if r["ok"]:
		say("", r["text"])
	elif r["text"] != "":
		say(v.get("farmer", ""), r["text"] + "\n…그럼 저는 어떡해요?", [
			["사과하고 돌려보내기", func(): _act(state.apologize(vid))],
			["조금만 기다려 달라고 하기", Callable()],
		], false)


func _talk_visitor(vid: int) -> void:
	var v := state.visitor_of(vid)
	if v.is_empty() or v["serving"]:
		return
	match v["stage"]:
		"창구":
			_counter_visitor(v)
		"출고대기":
			var unit := state.machine_of(state.reservation_of(v["res_id"])["unit_id"])
			say(v["farmer"], "%s 기다리고 있어요. 창고에서 꺼내 주세요~" % GameState.josa(unit.get("name", "장비"), "을", "를"))
		"반납대기":
			_return_menu(v)


func _return_menu(v: Dictionary) -> void:
	var unit := state.machine_of(state.reservation_of(v["res_id"])["unit_id"])
	var vid: int = v["id"]
	say(v["farmer"], "%s 반납하러 왔어요. 잘 썼어요." % unit.get("name", "장비"), [
		["간단히 확인하고 받기", func(): _act(state.receive_return(vid, false))],
		["꼼꼼히 점검하기 (%d분)" % D.INSPECT_RETURN_MIN, func(): _act(state.receive_return(vid, true))],
	])


func _machine_menu(unit_id: int) -> void:
	var back := state.return_visitor_for(unit_id)
	if not back.is_empty():
		_return_menu(back)
		return
	var m := state.machine_of(unit_id)
	if m.is_empty():
		return
	var lines: Array = ["%s · %s · 상태 %d%%" % [m["name"], m["status"], m["condition"]]]
	var days: Array = []
	for r in state.upcoming_reservations():
		if r["unit_id"] == unit_id:
			days.append(GameState.weekday_of(r["day"]))
	if not days.is_empty():
		lines.append("예약: " + ", ".join(days))
	var options: Array = []
	var pick := state.pickup_visitor_for(unit_id)
	if not pick.is_empty():
		lines.append("마당에서 %s 님이 기다리고 있습니다." % pick["farmer"])
		if m["status"] == "대기":
			options.append(["바로 출고", func(): _act(state.release_machine(unit_id, false))])
			options.append(["점검 후 출고 (%d분)" % D.INSPECT_RELEASE_MIN, func(): _act(state.release_machine(unit_id, true))])
	if m["status"] == "고장":
		var r: Array = D.MACHINE_TYPES[m["type"]]["repair"]
		options.append(["수리하기 (%d~%d분)" % [r[0], r[1]], func(): _act(state.repair(unit_id))])
	elif m["status"] == "대기" and int(m["condition"]) < 90:
		options.append(["정기 정비 (%d분)" % D.SERVICE_MIN, func(): _act(state.service(unit_id))])
	say("", "\n".join(lines), options)


func _pc_menu() -> void:
	var options: Array = []
	var pending := state.pending_requests()
	if not pending.is_empty():
		options.append(["예약 요청 처리 (%d건)" % pending.size(), _pc_requests])
	var received := state.calls_in("수신")
	if not received.is_empty():
		options.append(["출장 올리기 (%d건)" % received.size(), _pc_register])
	if not state.trip.is_empty() and state.trip["phase"] == "종료대기":
		options.append(["출장 종료", func(): say("", state.end_trip())])
	options.append(["확정된 예약 보기", _pc_schedule])
	options.append(["업무 일지 보기 (Tab)", func(): log_panel.visible = true])
	say("", "업무용 컴퓨터. 무엇을 할까요?", options)


func _pc_requests() -> void:
	var pending := state.pending_requests()
	if pending.is_empty():
		say("", "처리할 예약 요청이 없습니다.")
		return
	var r: Dictionary = pending[0]
	var rid: int = r["id"]
	var free := _free_units_text(r["type"])
	say("", "[예약 요청 %d건]\n%s 님 · %s · %s요일\n%s" % [pending.size(), r["farmer"], r["type"], GameState.weekday_of(r["day"]), free], [
		["장비 배정", func(): _after_request(state.assign_reservation(rid))],
		["거절", func(): _after_request(state.reject_reservation(rid))],
		["나중에", Callable()],
	], false)


func _after_request(msg: String) -> void:
	if msg != "":
		say("", msg, [["다음 요청", _pc_requests]])
	elif not state.pending_requests().is_empty():
		_pc_requests()


func _free_units_text(mtype: String) -> String:
	var names: Array = []
	for m in state.machines:
		if m["type"] == mtype:
			names.append("%s(%s)" % [m["name"], m["status"]])
	return "보유: " + ", ".join(names)


func _pc_register() -> void:
	var options: Array = []
	for c in state.calls_in("수신"):
		var cid: int = c["id"]
		options.append(["%s %s 님 · %s" % [c["village"], c["farmer"], c["machine"]], _register_trip.bind(cid)])
	say("", "어느 출장을 올릴까요?", options)


func _register_trip(cid: int) -> void:
	state.register_trip(cid)
	say("", "출장을 올렸습니다. 주차장 트럭으로 가서 출발하세요.")


func _pc_schedule() -> void:
	var lines: Array = []
	for r in state.upcoming_reservations():
		lines.append("· %s요일 %s 님 - %s" % [GameState.weekday_of(r["day"]), r["farmer"], state.machine_of(r["unit_id"]).get("name", r["type"])])
	say("", "[확정된 예약]\n" + ("\n".join(lines) if not lines.is_empty() else "없음"))


func _phone() -> void:
	if state.ringing.is_empty():
		say("", "전화기가 조용하다.")
		return
	var c := state.answer_phone()
	say(c["farmer"], "여보세요, %s 사는 %s인데요. %s %s 좀 와 주세요!" % [c["village"], c["farmer"], c["machine"], c["problem"]], [
		["알겠습니다. 바로 가겠습니다.", func(): say("", "컴퓨터에서 출장을 올린 뒤 트럭을 타고 출발하세요.")],
	], false)


func _talk_leader() -> void:
	if state.leader_has_words():
		_leader_event()
		return
	var options: Array = []
	if not state.proposal_used:
		options.append(["업무 개선안 올리기 (하루 한 번)", _propose])
	say(D.LEADER, LEADER_SMALL_TALK[state.rng.randi_range(0, LEADER_SMALL_TALK.size() - 1)], options)


func _propose() -> void:
	state.submit_proposal()
	_leader_event()


func _leader_event() -> void:
	var ev: Dictionary = state.events[0]["ev"]
	var options: Array = []
	for opt in ev["options"]:
		var o: Dictionary = opt
		options.append(["[%s] %s" % [o["tag"], o["text"]], func(): _leader_choose(o)])
	say("%s · %s" % [D.LEADER, ev["title"]], ev["text"], options, false)


func _leader_choose(o: Dictionary) -> void:
	state.choose(o)
	say(D.LEADER, o["reply"], [["확인", _after_leader_reply]], false)


func _after_leader_reply() -> void:
	if state.leader_has_words():
		_leader_event()


func _desk() -> void:
	say("", "내 자리. 모니터에 포스트잇이 잔뜩 붙어 있다.", [
		["커피 한 잔 (%d분, 스트레스 감소, 오늘 %d/%d)" % [D.COFFEE_MIN, state.coffee_count, D.COFFEE_PER_DAY], func(): _act(state.coffee())],
	])


func _truck() -> void:
	if world.map_kind == "village":
		if state.trip.get("fixed", false):
			say("", "수리를 마쳤습니다. 사업소로 돌아갈까요?", [["사업소로 복귀", func(): _act(state.leave_village())]])
		else:
			say("", "아직 수리하지 않았습니다. 그냥 돌아가면 민원이 생깁니다.", [["그래도 복귀", func(): _act(state.leave_village())]])
		return
	if not state.trip.is_empty():
		say("", "출장 종료는 사무실 컴퓨터에서 누르세요.")
		return
	var options: Array = []
	for c in state.calls_in("등록"):
		var cid: int = c["id"]
		options.append(["출발: %s %s 님 (편도 %d분)" % [c["village"], c["farmer"], c["travel"]], func(): _act(state.depart(cid))])
	if options.is_empty():
		say("", "등록된 출장이 없습니다.\n전화를 받고 컴퓨터에서 출장을 먼저 올리세요.")
	else:
		say("", "1톤 트럭. 어디로 갈까요?", options)


func _field_job() -> void:
	var farmer: String = state.trip.get("farmer", "")
	if state.trip.get("fixed", false):
		say(farmer, "고마워요! 덕분에 오늘 일 마치겠네. 조심히 들어가요.")
		return
	say(farmer, "아이고 왔어요? %s가 %s" % [state.trip["machine"], state.trip["problem"]], [
		["수리 시작 (약 %d분)" % int(state.trip["fix_min"]), func(): _act(state.start_field_repair())],
	])


func _act(msg: String) -> void:
	if msg != "":
		_toast(msg)


# ───────────────────────── 하루 정산, 엔딩 ─────────────────────────

func _show_day_summary() -> void:
	_summary_shown = true
	var s := state.day_stats
	var text := "\n".join([
		"창구·마당 업무 처리: %d건" % s["served"],
		"기다리다 돌아간 손님: %d명" % s["left"],
		"출장: %d건 (출장비 %s원)" % [s["trips"], GameState.comma(s["trip_pay"])],
		"수리: %d건" % s["repairs"],
		"",
		"팀장 관계 %d · 스트레스 %d · 민원 만족 %d · 업무 성과 %d" % [state.rel, state.stress, state.sat, state.perf],
	])
	var last: bool = state.day >= D.LAST_DAY
	say("%d일차 (%s요일) 업무 끝" % [state.day, GameState.weekday_of(state.day)], text, [
		["주간 평가 보기" if last else "다음 날 출근", _on_next_day],
	], false)


func _on_next_day() -> void:
	state.next_day()
	if state.ending == "":
		_summary_shown = false
		_last_location = "office"
		world.load_office(D.OFFICE_SPAWN)


func _show_ending() -> void:
	_ending_shown = true
	var e := _ending_text()
	var text := "%s\n\n팀장 관계 %d · 스트레스 %d · 민원 만족 %d · 업무 성과 %d\n받은 출장비 %s원" % [
		e[1], state.rel, state.stress, state.sat, state.perf, GameState.comma(state.money)]
	say(e[0], text, [["처음부터 다시", _new_game]], false)


func _ending_text() -> Array:
	match state.ending:
		"rel":
			return ["인사 발령", "팀장과의 갈등이 끝내 터졌습니다. 다음 주부터 산골 분소로 발령이 났습니다.\n…거기 분소장은 합리적인 사람이라는 소문이 있긴 합니다."]
		"stress":
			return ["병가", "쌓이고 쌓인 스트레스에 몸이 먼저 신호를 보냈습니다. 2주 병가를 냈습니다."]
		"sat":
			return ["감사 착수", "민원이 쏟아져 군청 감사팀이 사업소에 찾아왔습니다."]
	if state.rel < 35 and state.perf >= 40:
		return ["일 잘하는 앙숙", "팀장과는 매일 부딪혔지만 실적은 아무도 따라오지 못했습니다.\n과장님이 조용히 당신 이름을 수첩에 적습니다."]
	if state.rel >= 60 and state.sat >= 60:
		return ["믿음직한 신규", "팀장이 회식 자리에서 '요즘 신규 중엔 쟤가 제일 낫다'고 했답니다.\n본인 앞에서는 절대 말 안 하지만요."]
	if state.sat >= 70:
		return ["농민들의 주무관", "어르신들이 사업소에 오면 당신부터 찾습니다.\n책상 위엔 누가 두고 간 옥수수 한 봉지가 있습니다."]
	if state.rel >= 70:
		return ["팀장의 오른팔", "팀장 말은 다 들었습니다. 편하긴 한데… 이게 내가 원하던 일이었나 싶습니다."]
	return ["버텨낸 첫 주", "쉽지 않았지만 첫 주를 버텼습니다. 다음 주에도 트랙터는 고장 날 겁니다."]


# ───────────────────────── 대화창 ─────────────────────────

## 대화창을 연다. options: [[글자, Callable], ...] 비어 있으면 [확인] 하나.
## cancel이 true면 [닫기]가 붙고 Esc로 닫을 수 있다.
func say(speaker: String, text: String, options: Array = [], cancel := true) -> void:
	_dialog_open = true
	_dialog_cancel = cancel
	dialog_speaker.text = speaker
	dialog_speaker.visible = speaker != ""
	dialog_text.text = text
	_clear(dialog_options)
	var opts := options.duplicate()
	if opts.is_empty():
		opts = [["확인", Callable()]]
	elif cancel:
		opts.append(["닫기", Callable()])
	var first: Button = null
	for o in opts:
		var b := Button.new()
		b.text = o[0]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		var cb: Callable = o[1]
		b.pressed.connect(func(): _on_option(cb))
		dialog_options.add_child(b)
		if first == null:
			first = b
	dialog.show()
	first.grab_focus.call_deferred()


func close_dialog() -> void:
	_dialog_open = false
	dialog.hide()
	_clear(dialog_options)


func _on_option(cb: Callable) -> void:
	close_dialog()
	if cb.is_valid():
		cb.call()


func _input(event: InputEvent) -> void:
	if _dialog_open and _dialog_cancel and event.is_action_pressed("ui_cancel"):
		close_dialog()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("toggle_log"):
		log_panel.visible = not log_panel.visible
		get_viewport().set_input_as_handled()


# ───────────────────────── HUD ─────────────────────────

func _update_hud() -> void:
	var loc := state.location()
	var where := "사업소"
	if loc == "village":
		where = "출장 현장 · %s" % state.trip["village"]
	elif loc == "driving":
		where = "트럭 이동 중"
	status_label.text = "%d일차 %s요일   %s   %s" % [state.day, GameState.weekday_of(state.day), GameState.fmt_time(state.minute), where]
	stats_label.text = "팀장 관계 %d   스트레스 %d   민원 만족 %d   업무 성과 %d   출장비 %s원" % [
		state.rel, state.stress, state.sat, state.perf, GameState.comma(state.money)]
	stats_label.add_theme_color_override("font_color", C_RED if state.rel < 25 or state.stress > 75 or state.sat < 25 else C_TEXT)
	todo_label.text = "\n".join(_todo_lines())

	busy_panel.visible = not state.busy.is_empty()
	if busy_panel.visible:
		busy_label.text = "%s 중… (~%s)" % [state.busy["label"], GameState.fmt_time(state.busy["until"])]
		busy_bar.value = state.busy_progress() * 100.0

	drive_overlay.visible = loc == "driving"
	if drive_overlay.visible:
		if state.trip["phase"] == "이동":
			drive_label.text = "트럭을 타고 %s(으)로 가는 중…\n%s" % [state.trip["village"], GameState.fmt_time(state.minute)]
		else:
			drive_label.text = "사업소로 돌아가는 중…\n%s" % GameState.fmt_time(state.minute)
		drive_bar.value = state.drive_progress() * 100.0

	hint_label.text = "" if _dialog_open or not world.input_enabled else _hint_text(world.facing_target())


func _todo_lines() -> Array:
	var lines: Array = ["[할 일]"]
	if state.location() == "village":
		lines.append("· 고장 난 기계 수리하기" if not state.trip.get("fixed", false) else "· 트럭 타고 사업소로 복귀")
	if state.leader_has_words():
		lines.append("· %s 호출!" % D.LEADER)
	if not state.ringing.is_empty():
		lines.append("· 전화벨이 울립니다!")
	var n := state.visitors_at("창구").size()
	if n > 0:
		lines.append("· 창구 손님 %d명" % n)
	n = state.visitors_at("출고대기").size()
	if n > 0:
		lines.append("· 창고에서 출고 %d건" % n)
	n = state.visitors_at("반납대기").size()
	if n > 0:
		lines.append("· 마당 반납 확인 %d건" % n)
	n = state.pending_requests().size()
	if n > 0:
		lines.append("· 예약 요청 %d건 (컴퓨터)" % n)
	n = state.calls_in("수신").size()
	if n > 0:
		lines.append("· 출장 올리기 %d건 (컴퓨터)" % n)
	n = state.calls_in("등록").size()
	if n > 0 and state.trip.is_empty():
		lines.append("· 출장 출발 %d건 (트럭)" % n)
	if not state.trip.is_empty() and state.trip["phase"] == "종료대기":
		lines.append("· 출장 종료 누르기 (컴퓨터)")
	n = state.broken_count()
	if n > 0:
		lines.append("· 고장 장비 %d대 (창고)" % n)
	if lines.size() == 1:
		lines.append("· 지금은 한가합니다")
	return lines


func _hint_text(target: Dictionary) -> String:
	if target.is_empty():
		return ""
	var names := {
		"counter": "창구 업무", "visitor": "손님과 대화", "machine": "장비 살펴보기", "pc": "컴퓨터 쓰기",
		"phone": "전화 받기", "leader": "팀장과 대화", "desk": "내 자리", "truck": "트럭 타기",
		"sign": "안내판 읽기", "cabinet": "서류함 보기", "house": "농가", "job_machine": "고장 난 기계",
		"job_farmer": "농민과 대화",
	}
	return "[Space] " + str(names.get(target["type"], "살펴보기"))


func _on_logged(line: String) -> void:
	log_box.add_text(line + "\n")


func _toast(text: String) -> void:
	toast_label.text = text
	if _toast_tween:
		_toast_tween.kill()
	toast_label.modulate.a = 1.0
	_toast_tween = create_tween()
	_toast_tween.tween_interval(3.0)
	_toast_tween.tween_property(toast_label, "modulate:a", 0.0, 0.6)


# ───────────────────────── 화면 만들기 ─────────────────────────

func _setup_input() -> void:
	_add_action("move_up", [KEY_UP, KEY_W])
	_add_action("move_down", [KEY_DOWN, KEY_S])
	_add_action("move_left", [KEY_LEFT, KEY_A])
	_add_action("move_right", [KEY_RIGHT, KEY_D])
	_add_action("interact", [KEY_SPACE, KEY_ENTER, KEY_Z])
	_add_action("toggle_log", [KEY_TAB])
	_add_action("ui_accept", [KEY_Z]) # 대화창 선택도 Z로


func _add_action(action: String, keys: Array) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	for k in keys:
		var ev := InputEventKey.new()
		ev.keycode = k
		InputMap.action_add_event(action, ev)


func _load_fonts() -> void:
	_font = ThemeDB.fallback_font
	_bold = _font
	if ResourceLoader.exists("res://fonts/Pretendard-Regular.otf"):
		_font = load("res://fonts/Pretendard-Regular.otf")
	if ResourceLoader.exists("res://fonts/Pretendard-Bold.otf"):
		_bold = load("res://fonts/Pretendard-Bold.otf")


func _build_ui(layer: CanvasLayer) -> void:
	ui = Control.new()
	ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.theme = _make_theme()
	layer.add_child(ui)

	# 왼쪽 위: 날짜, 시간, 수치
	var top := _panel(ui, Control.PRESET_TOP_LEFT)
	var top_v := VBoxContainer.new()
	top.add_child(top_v)
	status_label = _label("", 20, true)
	top_v.add_child(status_label)
	stats_label = _label("", 14)
	top_v.add_child(stats_label)
	var keys := _label("이동: 방향키/WASD   상호작용: Space   닫기: Esc   업무 일지: Tab", 12)
	keys.add_theme_color_override("font_color", C_SUB)
	top_v.add_child(keys)

	# 오른쪽 위: 할 일
	todo_label = _label("", 14)
	todo_label.custom_minimum_size = Vector2(220, 0)
	var todo := _panel(ui, Control.PRESET_TOP_RIGHT)
	todo.add_child(todo_label)

	# 가운데 위: 알림
	toast_label = _label("", 17, true)
	toast_label.custom_minimum_size = Vector2(600, 0)
	ui.add_child(toast_label)
	_place(toast_label, Control.PRESET_CENTER_TOP, 120)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.add_theme_color_override("font_color", Color.WHITE)
	toast_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	toast_label.add_theme_constant_override("outline_size", 6)

	# 가운데: 작업 진행
	busy_panel = PanelContainer.new()
	busy_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	busy_panel.custom_minimum_size = Vector2(380, 70)
	ui.add_child(busy_panel)
	_place(busy_panel, Control.PRESET_CENTER)
	busy_panel.offset_top -= 160
	busy_panel.offset_bottom -= 160
	var busy_v := VBoxContainer.new()
	busy_panel.add_child(busy_v)
	busy_label = _label("", 16, true)
	busy_v.add_child(busy_label)
	busy_bar = ProgressBar.new()
	busy_bar.show_percentage = false
	busy_bar.custom_minimum_size = Vector2(0, 14)
	busy_v.add_child(busy_bar)
	busy_panel.hide()

	# 아래 가운데: 조작 힌트
	hint_label = _label("", 16, true)
	hint_label.custom_minimum_size = Vector2(400, 0)
	ui.add_child(hint_label)
	_place(hint_label, Control.PRESET_CENTER_BOTTOM, 24)
	hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint_label.add_theme_color_override("font_color", Color.WHITE)
	hint_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	hint_label.add_theme_constant_override("outline_size", 6)

	# 트럭 이동 화면
	drive_overlay = ColorRect.new()
	drive_overlay.color = Color("1d2a1f")
	drive_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.add_child(drive_overlay)
	var drive_center := CenterContainer.new()
	drive_center.set_anchors_preset(Control.PRESET_FULL_RECT)
	drive_overlay.add_child(drive_center)
	var drive_v := VBoxContainer.new()
	drive_v.custom_minimum_size = Vector2(420, 0)
	drive_v.add_theme_constant_override("separation", 16)
	drive_center.add_child(drive_v)
	drive_label = _label("", 22, true)
	drive_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	drive_label.add_theme_color_override("font_color", Color.WHITE)
	drive_v.add_child(drive_label)
	drive_bar = ProgressBar.new()
	drive_bar.show_percentage = false
	drive_bar.custom_minimum_size = Vector2(0, 16)
	drive_v.add_child(drive_bar)
	drive_overlay.hide()

	# 업무 일지 (Tab)
	log_panel = PanelContainer.new()
	ui.add_child(log_panel)
	log_panel.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	log_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	log_panel.offset_left = -392
	log_panel.offset_right = -12
	log_panel.offset_top = 200
	log_panel.offset_bottom = -12
	var log_v := VBoxContainer.new()
	log_panel.add_child(log_v)
	log_v.add_child(_label("업무 일지 (Tab으로 닫기)", 15, true))
	log_box = RichTextLabel.new()
	log_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	log_box.scroll_following = true
	log_box.add_theme_font_size_override("normal_font_size", 13)
	log_v.add_child(log_box)
	log_panel.hide()

	# 아래: 대화창
	dialog = PanelContainer.new()
	ui.add_child(dialog)
	dialog.add_theme_stylebox_override("panel", _box(C_PANEL, 10, 18, C_LINE, 3))
	dialog.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	dialog.grow_vertical = Control.GROW_DIRECTION_BEGIN
	dialog.offset_left = 24
	dialog.offset_right = -24
	dialog.offset_top = -16
	dialog.offset_bottom = -16
	dialog.mouse_filter = Control.MOUSE_FILTER_STOP
	var dv := VBoxContainer.new()
	dv.add_theme_constant_override("separation", 8)
	dialog.add_child(dv)
	dialog_speaker = _label("", 17, true)
	dialog_speaker.add_theme_color_override("font_color", C_ACCENT)
	dv.add_child(dialog_speaker)
	dialog_text = _label("", 18)
	dialog_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	dv.add_child(dialog_text)
	dialog_options = VBoxContainer.new()
	dialog_options.add_theme_constant_override("separation", 4)
	dv.add_child(dialog_options)
	dialog.hide()


func _make_theme() -> Theme:
	var t := Theme.new()
	t.default_font = _font
	t.default_font_size = 15
	t.set_color("font_color", "Label", C_TEXT)
	t.set_color("default_color", "RichTextLabel", C_TEXT)
	t.set_stylebox("panel", "PanelContainer", _box(Color(C_PANEL, 0.94), 8, 12, Color(C_LINE, 0.5), 1))
	var btn := _box(Color("efe6d2"), 6, 8)
	t.set_stylebox("normal", "Button", btn)
	t.set_stylebox("hover", "Button", _box(Color("e2d6bb"), 6, 8))
	t.set_stylebox("pressed", "Button", _box(Color("d4c6a6"), 6, 8))
	t.set_stylebox("hover_pressed", "Button", _box(Color("d4c6a6"), 6, 8))
	var focus := _box(Color.TRANSPARENT, 6, 8, C_ACCENT, 3)
	focus.draw_center = false
	t.set_stylebox("focus", "Button", focus)
	for c in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		t.set_color(c, "Button", C_TEXT)
	t.set_font_size("font_size", "Button", 16)
	var bar_bg := _box(Color("d8cfbd"), 4, 0)
	var bar_fill := _box(C_ACCENT, 4, 0)
	t.set_stylebox("background", "ProgressBar", bar_bg)
	t.set_stylebox("fill", "ProgressBar", bar_fill)
	return t


func _panel(parent: Control, preset: Control.LayoutPreset, margin := 12) -> PanelContainer:
	var p := PanelContainer.new()
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(p)
	_place(p, preset, margin)
	return p


## 화면 모서리/가운데에 붙인다. 내용이 늘어나면 화면 안쪽으로 커지게 한다.
func _place(c: Control, preset: Control.LayoutPreset, margin := 12) -> void:
	c.set_anchors_and_offsets_preset(preset, Control.PRESET_MODE_MINSIZE, margin)
	match preset:
		Control.PRESET_TOP_RIGHT, Control.PRESET_RIGHT_WIDE, Control.PRESET_BOTTOM_RIGHT:
			c.grow_horizontal = Control.GROW_DIRECTION_BEGIN
		Control.PRESET_CENTER, Control.PRESET_CENTER_TOP, Control.PRESET_CENTER_BOTTOM:
			c.grow_horizontal = Control.GROW_DIRECTION_BOTH
	match preset:
		Control.PRESET_BOTTOM_WIDE, Control.PRESET_CENTER_BOTTOM, Control.PRESET_BOTTOM_RIGHT:
			c.grow_vertical = Control.GROW_DIRECTION_BEGIN
		Control.PRESET_CENTER:
			c.grow_vertical = Control.GROW_DIRECTION_BOTH


func _label(text: String, font_size := 15, bold := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", font_size)
	if bold:
		l.add_theme_font_override("font", _bold)
	return l


func _clear(node: Node) -> void:
	for c in node.get_children():
		node.remove_child(c)
		c.queue_free()


func _box(bg: Color, radius: int, pad: float, border := Color.TRANSPARENT, border_w := 1) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(radius)
	sb.set_content_margin_all(pad)
	if border.a > 0.0:
		sb.set_border_width_all(border_w)
		sb.border_color = border
	return sb
