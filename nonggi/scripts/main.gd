extends Control
## 화면 구성과 입력 처리. 게임 규칙은 game_state.gd에 있다.
## 노드를 에디터에서 배치하지 않고 코드로 만든다 (AI와 함께 고치기 쉽도록).

const D = preload("res://scripts/data.gd")
const GameState = preload("res://scripts/game_state.gd")

const MIN_PER_SEC := 2.0 # 1배속: 현실 1초 = 게임 2분 (하루 약 4분 30초)
const SPEEDS := [0.0, 1.0, 2.0, 4.0]
const SPEED_NAMES := ["일시정지", "1배", "2배", "4배"]

const C_BG := Color("e9e2d2")
const C_PANEL := Color("faf6ec")
const C_CARD := Color("ffffff")
const C_TEXT := Color("2d2a26")
const C_SUB := Color("7a7166")
const C_LINE := Color("d8cfbd")
const C_ACCENT := Color("4f7a3a")
const C_RED := Color("b4443a")
const C_BLUE := Color("3a6a9a")
const C_ORANGE := Color("c27a1e")

var state: GameState
var speed := 1.0
var _acc := 0.0
var _dirty := true
var _last_rebuild_minute := -999
var _modal_mode := ""
var _toast_tween: Tween

var _bold: Font
var day_label: Label
var time_label: Label
var place_label: Label
var stat_labels := {}
var speed_buttons: Array = []
var proposal_button: Button
var machine_list: VBoxContainer
var tabs: TabContainer
var counter_list: VBoxContainer
var reserve_list: VBoxContainer
var call_list: VBoxContainer
var log_box: RichTextLabel
var busy_label: Label
var toast_label: Label
var end_trip_button: Button
var modal: Control
var modal_title: Label
var modal_body: Label
var modal_options: VBoxContainer


func _ready() -> void:
	_setup_theme()
	_build_layout()
	_build_modal()
	_new_game()


func _new_game() -> void:
	state = GameState.new()
	state.changed.connect(func(): _dirty = true)
	state.logged.connect(_on_logged)
	state.event_raised.connect(_on_event_raised)
	state.day_finished.connect(_show_next_modal)
	state.game_finished.connect(_on_game_finished)
	log_box.clear()
	for line in state.log_lines:
		_on_logged(line)
	speed = 1.0
	_acc = 0.0
	_modal_mode = ""
	modal.hide()
	_dirty = true


func _process(delta: float) -> void:
	if state == null:
		return
	if not modal.visible and speed > 0.0 and not state.day_over and state.ending == "":
		_acc += delta * speed * MIN_PER_SEC
		while _acc >= 1.0:
			_acc -= 1.0
			state.step()
			if modal.visible or state.day_over or state.ending != "":
				_acc = 0.0
				break
	# 남은 시간 표시가 바뀌도록 5분마다 목록을 다시 그린다
	if _dirty or abs(state.minute - _last_rebuild_minute) >= 5:
		_rebuild()
	_update_top()


# ───────────────────────── 상단, 하단 ─────────────────────────

func _update_top() -> void:
	day_label.text = "%d일차 %s요일" % [state.day, GameState.weekday_of(state.day)]
	time_label.text = GameState.fmt_time(state.minute)
	if state.is_away():
		place_label.text = "출장 중 · %s" % state.trip["village"]
		place_label.add_theme_color_override("font_color", C_ORANGE)
	else:
		place_label.text = "사업소"
		place_label.add_theme_color_override("font_color", C_ACCENT)
	_set_stat("rel", "팀장 관계", state.rel, state.rel < 25)
	_set_stat("stress", "스트레스", state.stress, state.stress > 75)
	_set_stat("sat", "민원 만족", state.sat, state.sat < 25)
	stat_labels["perf"].text = "업무 성과 %d" % state.perf
	stat_labels["money"].text = "출장비 %s원" % GameState.comma(state.money)
	proposal_button.disabled = state.proposal_used or not state.can_act()
	for i in speed_buttons.size():
		speed_buttons[i].button_pressed = is_equal_approx(SPEEDS[i], speed)

	if not state.busy.is_empty():
		busy_label.text = "작업 중: %s (~%s)" % [state.busy["label"], GameState.fmt_time(state.busy["until"])]
	elif state.is_away():
		busy_label.text = _trip_phase_text()
	elif not state.trip.is_empty():
		busy_label.text = "출장에서 복귀했습니다. [출장 종료]를 눌러주세요."
	elif state.minute >= D.DAY_END:
		busy_label.text = "퇴근 시간입니다."
	else:
		busy_label.text = "업무 가능"
	end_trip_button.visible = not state.trip.is_empty() and state.trip["phase"] == "종료대기"


func _set_stat(key: String, title: String, value: int, danger: bool) -> void:
	var l: Label = stat_labels[key]
	l.text = "%s %d" % [title, value]
	l.add_theme_color_override("font_color", C_RED if danger else C_TEXT)


func _trip_phase_text() -> String:
	var t := state.trip
	var until := GameState.fmt_time(t["phase_end"])
	match t["phase"]:
		"이동":
			return "%s(으)로 이동 중 (도착 %s)" % [t["village"], until]
		"현장수리":
			return "%s 현장 수리 중 (완료 %s)" % [t["village"], until]
		"복귀":
			return "사업소로 복귀 중 (도착 %s)" % until
	return ""


func _on_logged(line: String) -> void:
	log_box.add_text(line + "\n")


func _toast(text: String) -> void:
	toast_label.text = text
	if _toast_tween:
		_toast_tween.kill()
	toast_label.modulate.a = 1.0
	_toast_tween = create_tween()
	_toast_tween.tween_interval(2.5)
	_toast_tween.tween_property(toast_label, "modulate:a", 0.0, 0.5)


func _act(result: String) -> void:
	if result != "":
		_toast(result)
	_dirty = true


# ───────────────────────── 목록 다시 그리기 ─────────────────────────

func _rebuild() -> void:
	_dirty = false
	_last_rebuild_minute = state.minute
	_rebuild_machines()
	_rebuild_counter()
	_rebuild_reservations()
	_rebuild_calls()


func _rebuild_machines() -> void:
	_clear(machine_list)
	var can := state.can_act()
	for m in state.machines:
		var card := _card(machine_list)
		var head := HBoxContainer.new()
		card.add_child(head)
		var name_label := _label(m["name"], 16, true)
		name_label.clip_text = true
		name_label.size_flags_horizontal = SIZE_EXPAND_FILL
		head.add_child(name_label)
		var status_label := _label(m["status"], 15, true)
		status_label.add_theme_color_override("font_color", _status_color(m["status"]))
		head.add_child(status_label)

		var info := "상태 %d%%" % m["condition"]
		if m["status"] == "임대중":
			info += " · %s 님 사용 중" % m["renter"]
		var days := []
		for r in state.upcoming_reservations():
			if r["unit_id"] == m["id"]:
				days.append(GameState.weekday_of(r["day"]))
		if not days.is_empty():
			info += " · 예약: %s" % ", ".join(days)
		var info_label := _label(info, 13, false, true)
		info_label.add_theme_color_override("font_color", C_RED if int(m["condition"]) < 40 else C_SUB)
		card.add_child(info_label)

		var unit_id: int = m["id"]
		if m["status"] == "고장":
			_buttons(card, [["수리하기", func(): _act(state.repair(unit_id)), not can]])
		elif m["status"] == "대기" and int(m["condition"]) < 70:
			_buttons(card, [["정기 정비 (%d분)" % D.SERVICE_MIN, func(): _act(state.service(unit_id)), not can]])


func _rebuild_counter() -> void:
	_clear(counter_list)
	tabs.set_tab_title(0, "창구 (%d)" % state.counter.size())
	if state.counter.is_empty():
		_hint(counter_list, "기다리는 손님이 없습니다.")
		return
	var can := state.can_act()
	for v in state.counter:
		var res := state.reservation_of(v["res_id"])
		var unit := state.machine_of(res["unit_id"])
		var card := _card(counter_list)
		var what := "빌리러 오셨습니다" if v["kind"] == "대여" else "반납하러 오셨습니다"
		card.add_child(_label("%s 님 · %s %s" % [v["farmer"], res["type"], what], 16, true, true))
		if v["serving"]:
			card.add_child(_label("처리 중…", 13, false, true))
			continue
		var detail := ""
		if not unit.is_empty():
			detail = "배정 장비: %s [%s] · " % [unit["name"], unit["status"]]
		var left: int = state.visitor_patience(v)
		var detail_label := _label(detail + "%d분 더 기다려 주실 것 같습니다" % maxi(left, 0), 13, false, true)
		detail_label.add_theme_color_override("font_color", C_RED if left < 15 else C_SUB)
		card.add_child(detail_label)
		var vid: int = v["id"]
		if v["kind"] == "대여":
			_buttons(card, [
				["바로 출고", func(): _act(state.release(vid, false)), not can],
				["점검 후 출고 (%d분)" % D.INSPECT_RELEASE_MIN, func(): _act(state.release(vid, true)), not can],
				["사과하고 돌려보내기", func(): _act(state.apologize(vid)), not can],
			])
		else:
			_buttons(card, [
				["간단히 확인", func(): _act(state.receive_return(vid, false)), not can],
				["꼼꼼히 점검 (%d분)" % D.INSPECT_RETURN_MIN, func(): _act(state.receive_return(vid, true)), not can],
			])


func _rebuild_reservations() -> void:
	_clear(reserve_list)
	var pending := state.pending_requests()
	tabs.set_tab_title(1, "예약 (%d)" % pending.size())
	var away := state.is_away()
	reserve_list.add_child(_label("새 예약 요청", 16, true))
	if pending.is_empty():
		_hint(reserve_list, "새 요청이 없습니다.")
	for r in pending:
		var card := _card(reserve_list)
		card.add_child(_label("%s 님 · %s · %s요일" % [r["farmer"], r["type"], GameState.weekday_of(r["day"])], 16, true, true))
		var rid: int = r["id"]
		_buttons(card, [
			["장비 배정", func(): _act(state.assign_reservation(rid)), away],
			["거절", func(): _act(state.reject_reservation(rid)), away],
		])
	reserve_list.add_child(_spacer(8))
	reserve_list.add_child(_label("확정된 예약", 16, true))
	var upcoming := state.upcoming_reservations()
	if upcoming.is_empty():
		_hint(reserve_list, "확정된 예약이 없습니다.")
	for r in upcoming:
		var unit := state.machine_of(r["unit_id"])
		var line := "· %s요일 · %s 님 · %s" % [GameState.weekday_of(r["day"]), r["farmer"], unit.get("name", r["type"])]
		reserve_list.add_child(_label(line, 14, false, true))


func _rebuild_calls() -> void:
	_clear(call_list)
	tabs.set_tab_title(2, "전화·출장 (%d)" % state.calls.filter(func(c): return c["state"] != "진행중").size())
	var rule := _label("출장비 규정: 출발부터 [출장 종료]까지 %s 이상이면 %s원, 미만이면 무급" % [
		GameState.fmt_duration(D.TRIP_PAY_MINUTES), GameState.comma(D.TRIP_PAY)], 13, false, true)
	rule.add_theme_color_override("font_color", C_SUB)
	call_list.add_child(rule)

	var t := state.trip
	if not t.is_empty():
		var card := _card(call_list, C_ORANGE)
		card.add_child(_label("진행 중인 출장 · %s %s 님 (%s)" % [t["village"], t["farmer"], t["machine"]], 16, true, true))
		var elapsed := GameState.fmt_duration(state.minute - int(t["start"]))
		if t["phase"] == "종료대기":
			var since: int = state.minute - int(t["return_time"])
			card.add_child(_label("복귀 완료 · 출발 후 %s · 복귀 후 %d분 지남" % [elapsed, since], 14, false, true))
			_buttons(card, [["출장 종료", func(): _act(state.end_trip()), false]])
		else:
			card.add_child(_label("%s · 출발 후 %s" % [_trip_phase_text(), elapsed], 14, false, true))

	var can := state.can_act()
	var waiting := false
	for c in state.calls:
		if c["state"] == "진행중":
			continue
		waiting = true
		var card := _card(call_list)
		card.add_child(_label("%s 님 · %s · %s" % [c["farmer"], c["machine"], c["problem"]], 16, true, true))
		var info := _label("%s (편도 %d분) · %s까지 가야 합니다" % [c["village"], c["travel"], GameState.fmt_time(c["expire"])], 13, false, true)
		info.add_theme_color_override("font_color", C_SUB)
		card.add_child(info)
		var cid: int = c["id"]
		if c["state"] == "수신":
			_buttons(card, [["출장 올리기", func(): _act(state.register_trip(cid)), state.is_away()]])
		else:
			_buttons(card, [["출발", func(): _act(state.depart(cid)), not can or not state.trip.is_empty()]])
	if not waiting and t.is_empty():
		_hint(call_list, "걸려 온 고장 전화가 없습니다.")


# ───────────────────────── 팝업 (팀장 이벤트, 하루 정산, 엔딩) ─────────────────────────

func _on_event_raised() -> void:
	if not modal.visible:
		_show_next_modal()


func _on_game_finished() -> void:
	if _modal_mode != "reply":
		_show_next_modal()


func _show_next_modal() -> void:
	if state.ending != "":
		_show_ending()
	elif not state.events.is_empty():
		_show_event(state.events[0])
	elif state.day_over:
		_show_day_summary()
	else:
		_modal_mode = ""
		modal.hide()


func _show_event(ev: Dictionary) -> void:
	_modal_mode = "event"
	modal_title.text = "%s · %s" % [ev["title"], D.LEADER]
	modal_body.text = "\"%s\"" % ev["text"]
	_clear(modal_options)
	for opt in ev["options"]:
		var o: Dictionary = opt
		_modal_button("[%s] %s" % [o["tag"], o["text"]], func(): _on_choose(o))
	var hint := _label("직설 = ENTJ답게 할 말은 한다 · 수긍 = 일단 숙인다 · 절충 = 대안을 낸다", 13, false, true)
	hint.add_theme_color_override("font_color", C_SUB)
	modal_options.add_child(hint)
	modal.show()


func _on_choose(option: Dictionary) -> void:
	_modal_mode = "reply"
	state.choose(option)
	modal_body.text = "%s: \"%s\"" % [D.LEADER, option["reply"]]
	_clear(modal_options)
	_modal_button("확인", _show_next_modal)


func _show_day_summary() -> void:
	_modal_mode = "day"
	var s := state.day_stats
	modal_title.text = "%d일차 (%s요일) 업무 끝" % [state.day, GameState.weekday_of(state.day)]
	modal_body.text = "\n".join([
		"창구 업무 처리: %d건" % s["served"],
		"기다리다 돌아간 손님: %d명" % s["left"],
		"출장: %d건 (출장비 %s원)" % [s["trips"], GameState.comma(s["trip_pay"])],
		"수리: %d건" % s["repairs"],
		"",
		"팀장 관계 %d · 스트레스 %d · 민원 만족 %d · 업무 성과 %d" % [state.rel, state.stress, state.sat, state.perf],
	])
	_clear(modal_options)
	var last: bool = state.day >= D.LAST_DAY
	_modal_button("주간 평가 보기" if last else "다음 날 출근", func(): _on_next_day())
	modal.show()


func _on_next_day() -> void:
	state.next_day()
	if state.ending == "":
		_modal_mode = ""
		modal.hide()
		_dirty = true


func _show_ending() -> void:
	_modal_mode = "ending"
	var e := _ending_text()
	modal_title.text = e[0]
	modal_body.text = "%s\n\n팀장 관계 %d · 스트레스 %d · 민원 만족 %d · 업무 성과 %d\n받은 출장비 %s원" % [
		e[1], state.rel, state.stress, state.sat, state.perf, GameState.comma(state.money)]
	_clear(modal_options)
	_modal_button("처음부터 다시", _new_game)
	modal.show()


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


func _modal_button(text: String, on_press: Callable) -> void:
	var b := Button.new()
	b.text = text
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	b.custom_minimum_size = Vector2(0, 44)
	b.pressed.connect(on_press)
	modal_options.add_child(b)


# ───────────────────────── 화면 만들기 ─────────────────────────

func _setup_theme() -> void:
	var t := Theme.new()
	if ResourceLoader.exists("res://fonts/Pretendard-Regular.otf"):
		t.default_font = load("res://fonts/Pretendard-Regular.otf")
	if ResourceLoader.exists("res://fonts/Pretendard-Bold.otf"):
		_bold = load("res://fonts/Pretendard-Bold.otf")
	t.default_font_size = 15
	t.set_color("font_color", "Label", C_TEXT)
	t.set_color("default_color", "RichTextLabel", C_TEXT)
	t.set_stylebox("panel", "PanelContainer", _box(C_PANEL, 10, 12, C_LINE))
	t.set_stylebox("panel", "TabContainer", _box(C_PANEL, 10, 12, C_LINE))
	t.set_stylebox("tab_selected", "TabContainer", _box(C_PANEL, 6, 8, C_LINE))
	t.set_stylebox("tab_unselected", "TabContainer", _box(C_BG, 6, 8))
	t.set_stylebox("tab_hovered", "TabContainer", _box(C_LINE, 6, 8))
	t.set_color("font_selected_color", "TabContainer", C_TEXT)
	t.set_color("font_unselected_color", "TabContainer", C_SUB)
	t.set_color("font_hovered_color", "TabContainer", C_TEXT)
	t.set_stylebox("normal", "Button", _box(C_ACCENT, 6, 8))
	t.set_stylebox("hover", "Button", _box(C_ACCENT.lightened(0.15), 6, 8))
	t.set_stylebox("pressed", "Button", _box(C_ACCENT.darkened(0.25), 6, 8))
	t.set_stylebox("hover_pressed", "Button", _box(C_ACCENT.darkened(0.25), 6, 8))
	t.set_stylebox("disabled", "Button", _box(Color("c9c1b2"), 6, 8))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	for c in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		t.set_color(c, "Button", Color.WHITE)
	t.set_color("font_disabled_color", "Button", Color("f4f0e8"))
	theme = t


func _build_layout() -> void:
	var bg := ColorRect.new()
	bg.color = C_BG
	bg.set_anchors_preset(PRESET_FULL_RECT)
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 12)
	add_child(margin)
	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 10)
	margin.add_child(root)

	# 상단: 날짜, 시간, 위치, 속도 / 수치
	var top_panel := PanelContainer.new()
	root.add_child(top_panel)
	var top := VBoxContainer.new()
	top_panel.add_child(top)
	var row1 := HBoxContainer.new()
	row1.add_theme_constant_override("separation", 16)
	top.add_child(row1)
	row1.add_child(_label("농기계 임대사업소", 20, true))
	day_label = _label("", 18, true)
	row1.add_child(day_label)
	time_label = _label("", 22, true)
	row1.add_child(time_label)
	place_label = _label("", 16, true)
	row1.add_child(place_label)
	var gap := Control.new()
	gap.size_flags_horizontal = SIZE_EXPAND_FILL
	row1.add_child(gap)
	proposal_button = Button.new()
	proposal_button.text = "개선안 올리기"
	proposal_button.tooltip_text = "ENTJ의 본능. 하루 한 번 팀장에게 업무 개선안을 올린다."
	proposal_button.pressed.connect(func(): _act(state.submit_proposal()))
	row1.add_child(proposal_button)
	var group := ButtonGroup.new()
	for i in SPEEDS.size():
		var b := Button.new()
		b.text = SPEED_NAMES[i]
		b.toggle_mode = true
		b.button_group = group
		var s: float = SPEEDS[i]
		b.pressed.connect(func(): speed = s)
		row1.add_child(b)
		speed_buttons.append(b)

	var row2 := HBoxContainer.new()
	row2.add_theme_constant_override("separation", 24)
	top.add_child(row2)
	row2.add_child(_label("나: 신규 주무관 (ENTJ)", 14))
	for key in ["rel", "stress", "sat", "perf", "money"]:
		var l := _label("", 14, true)
		stat_labels[key] = l
		row2.add_child(l)

	# 가운데: 장비 / 탭 / 업무 일지
	var body := HBoxContainer.new()
	body.size_flags_vertical = SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 10)
	root.add_child(body)

	machine_list = _side_panel(body, "농기계 현황", 330)

	tabs = TabContainer.new()
	tabs.size_flags_horizontal = SIZE_EXPAND_FILL
	body.add_child(tabs)
	counter_list = _tab_page("창구")
	reserve_list = _tab_page("예약")
	call_list = _tab_page("전화·출장")

	var log_panel := PanelContainer.new()
	log_panel.custom_minimum_size = Vector2(320, 0)
	body.add_child(log_panel)
	var log_v := VBoxContainer.new()
	log_panel.add_child(log_v)
	log_v.add_child(_label("업무 일지", 17, true))
	log_box = RichTextLabel.new()
	log_box.size_flags_vertical = SIZE_EXPAND_FILL
	log_box.scroll_following = true
	log_box.add_theme_font_size_override("normal_font_size", 13)
	log_v.add_child(log_box)

	# 하단: 지금 하는 일, 출장 종료 버튼, 알림
	var bottom := PanelContainer.new()
	root.add_child(bottom)
	var bottom_h := HBoxContainer.new()
	bottom_h.add_theme_constant_override("separation", 12)
	bottom.add_child(bottom_h)
	busy_label = _label("", 15, true)
	bottom_h.add_child(busy_label)
	end_trip_button = Button.new()
	end_trip_button.text = "출장 종료"
	end_trip_button.pressed.connect(func(): _act(state.end_trip()))
	bottom_h.add_child(end_trip_button)
	toast_label = _label("", 15, true)
	toast_label.add_theme_color_override("font_color", C_RED)
	toast_label.size_flags_horizontal = SIZE_EXPAND_FILL
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	bottom_h.add_child(toast_label)


func _build_modal() -> void:
	modal = Control.new()
	modal.set_anchors_preset(PRESET_FULL_RECT)
	modal.mouse_filter = MOUSE_FILTER_STOP
	add_child(modal)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_preset(PRESET_FULL_RECT)
	modal.add_child(dim)
	var center := CenterContainer.new()
	center.set_anchors_preset(PRESET_FULL_RECT)
	modal.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(640, 0)
	panel.add_theme_stylebox_override("panel", _box(C_PANEL, 12, 24, C_ACCENT))
	center.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	panel.add_child(v)
	modal_title = _label("", 22, true)
	v.add_child(modal_title)
	modal_body = _label("", 17, false, true)
	modal_body.custom_minimum_size = Vector2(590, 0)
	v.add_child(modal_body)
	modal_options = VBoxContainer.new()
	modal_options.add_theme_constant_override("separation", 8)
	v.add_child(modal_options)
	modal.hide()


func _side_panel(parent: Control, title: String, width: float) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(width, 0)
	parent.add_child(panel)
	var v := VBoxContainer.new()
	panel.add_child(v)
	v.add_child(_label(title, 17, true))
	return _scroll_list(v)


func _tab_page(title: String) -> VBoxContainer:
	var page := VBoxContainer.new()
	tabs.add_child(page)
	tabs.set_tab_title(tabs.get_tab_count() - 1, title)
	return _scroll_list(page)


func _scroll_list(parent: Control) -> VBoxContainer:
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	parent.add_child(scroll)
	var list := VBoxContainer.new()
	list.size_flags_horizontal = SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 8)
	scroll.add_child(list)
	return list


# ───────────────────────── 작은 도우미 ─────────────────────────

func _card(parent: Control, border := C_LINE) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _box(C_CARD, 8, 10, border))
	parent.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	panel.add_child(v)
	return v


## buttons: [[글자, 눌렀을 때 함수, 비활성 여부], ...]
func _buttons(parent: Control, buttons: Array) -> void:
	var h := HFlowContainer.new()
	h.add_theme_constant_override("h_separation", 6)
	h.add_theme_constant_override("v_separation", 6)
	parent.add_child(h)
	for spec in buttons:
		var b := Button.new()
		b.text = spec[0]
		b.disabled = spec[2]
		b.pressed.connect(spec[1])
		h.add_child(b)


## wrap: 세로 목록(VBox) 안에서만 켠다. 가로 줄(HBox)에서 켜면 글자가 한 줄에 한 자씩 찌그러진다.
func _label(text: String, font_size := 15, bold := false, wrap := false) -> Label:
	var l := Label.new()
	l.text = text
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", font_size)
	if bold and _bold:
		l.add_theme_font_override("font", _bold)
	return l


func _hint(parent: Control, text: String) -> void:
	var l := _label(text, 14, false, true)
	l.add_theme_color_override("font_color", C_SUB)
	parent.add_child(l)


func _spacer(h: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c


func _clear(node: Node) -> void:
	for c in node.get_children():
		node.remove_child(c)
		c.queue_free()


func _status_color(status: String) -> Color:
	match status:
		"대기":
			return C_ACCENT
		"임대중":
			return C_BLUE
		"고장":
			return C_RED
	return C_ORANGE


func _box(bg: Color, radius: int, pad: float, border := Color.TRANSPARENT) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(radius)
	sb.set_content_margin_all(pad)
	if border.a > 0.0:
		sb.set_border_width_all(1)
		sb.border_color = border
	return sb
