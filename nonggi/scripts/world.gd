extends Node2D
## 걸어 다니는 지도 (포켓몬처럼 한 칸씩 이동).
## 그림 파일 없이 타일, 사람, 장비를 도형으로 그린다. 나중에 그림으로 바꾸려면 _draw_* 함수만 고치면 된다.

signal interacted(target: Dictionary)

const D = preload("res://scripts/data.gd")
const GameState = preload("res://scripts/game_state.gd")
const T: int = D.TILE
const STEP_TIME := 0.16 # 한 칸 걷는 데 걸리는 현실 시간(초)

const SKIN := Color("f1c9a0")
## 눌러서 쓸 수 있는 칸
const TILE_TARGETS := {
	"C": "counter", "P": "pc", "T": "phone", "L": "leader", "M": "desk",
	"K": "truck", "S": "sign", "B": "cabinet", "H": "house",
}
const INK := Color("2d2a26")

var state: GameState # main.gd가 넣어 준다
var font: Font
var map_rows: Array = []
var map_kind := "office" # office / village
var village_name := ""
var job: Dictionary = {} # 마을에서 고장 난 기계와 농민 자리 {machine, farmer}
var player_tile := Vector2i.ZERO
var player_pos := Vector2.ZERO
var facing := Vector2i.DOWN
var input_enabled := true

var _moving := false
var _from := Vector2.ZERO
var _to := Vector2.ZERO
var _t := 0.0
var _clock := 0.0
var _camera: Camera2D


func _ready() -> void:
	_camera = Camera2D.new()
	_camera.position_smoothing_enabled = true
	_camera.position_smoothing_speed = 10.0
	add_child(_camera)
	_camera.make_current()


func load_office(spawn: Vector2i) -> void:
	map_kind = "office"
	map_rows = D.OFFICE_MAP
	village_name = ""
	job = {}
	_place_player(spawn, Vector2i.UP)


func load_village(vname: String, spawn: Vector2i) -> void:
	map_kind = "village"
	map_rows = D.VILLAGE_MAP
	village_name = vname
	job = D.JOB_SPOTS[absi(vname.hash()) % D.JOB_SPOTS.size()]
	_place_player(spawn, Vector2i.UP)


func _place_player(tile: Vector2i, dir: Vector2i) -> void:
	player_tile = tile
	player_pos = Vector2(tile * T)
	facing = dir
	_moving = false
	var size := Vector2(map_rows[0].length(), map_rows.size()) * T
	_camera.limit_left = 0
	_camera.limit_top = 0
	_camera.limit_right = int(size.x)
	_camera.limit_bottom = int(size.y)
	_camera.position = player_pos + Vector2(T, T) / 2
	_camera.reset_smoothing()


# ───────────────────────── 이동 ─────────────────────────

func _process(delta: float) -> void:
	_clock += delta
	if _moving:
		_t += delta / STEP_TIME
		if _t >= 1.0:
			_moving = false
			player_pos = _to
		else:
			player_pos = _from.lerp(_to, _t)
	if not _moving and input_enabled:
		var dir := _input_dir()
		if dir != Vector2i.ZERO:
			facing = dir
			var target := player_tile + dir
			if is_walkable(target):
				player_tile = target
				_from = player_pos
				_to = Vector2(target * T)
				_t = 0.0
				_moving = true
	_camera.position = player_pos + Vector2(T, T) / 2
	queue_redraw()


func _input_dir() -> Vector2i:
	if Input.is_action_pressed("move_up"):
		return Vector2i.UP
	if Input.is_action_pressed("move_down"):
		return Vector2i.DOWN
	if Input.is_action_pressed("move_left"):
		return Vector2i.LEFT
	if Input.is_action_pressed("move_right"):
		return Vector2i.RIGHT
	return Vector2i.ZERO


func _unhandled_input(event: InputEvent) -> void:
	if not event.is_action_pressed("interact") or not input_enabled or _moving:
		return
	var target := facing_target()
	if not target.is_empty():
		get_viewport().set_input_as_handled()
		interacted.emit(target)


func tile_char(t: Vector2i) -> String:
	if t.y < 0 or t.y >= map_rows.size():
		return "t"
	var row: String = map_rows[t.y]
	if t.x < 0 or t.x >= row.length():
		return "t"
	return row[t.x]


func is_walkable(t: Vector2i) -> bool:
	return D.WALKABLE.contains(tile_char(t)) and not entities().has(t)


## 바라보는 칸에 무엇이 있는지. 비어 있으면 {}
func facing_target() -> Dictionary:
	var t := player_tile + facing
	var ents := entities()
	if ents.has(t):
		return ents[t]
	var kind: String = TILE_TARGETS.get(tile_char(t), "")
	if kind != "":
		return {"type": kind}
	return {}


## 지도 위의 사람과 장비. {칸: {type, id}}
func entities() -> Dictionary:
	var ents := {}
	if state == null:
		return ents
	if map_kind == "village":
		if not job.is_empty():
			ents[job["machine"]] = {"type": "job_machine"}
			ents[job["farmer"]] = {"type": "job_farmer"}
		return ents
	ents[D.LEADER_POS] = {"type": "leader"}
	var at_return := {}
	var returns: Array = state.visitors_at("반납대기")
	for i in mini(returns.size(), D.RETURN_SPOTS.size()):
		var v: Dictionary = returns[i]
		var uid: int = state.reservation_of(v["res_id"]).get("unit_id", -1)
		at_return[uid] = true
		ents[D.RETURN_SPOTS[i]["farmer"]] = {"type": "visitor", "id": v["id"]}
		ents[D.RETURN_SPOTS[i]["machine"]] = {"type": "machine", "id": uid}
	for m in state.machines:
		if m["status"] == "임대중" or at_return.has(m["id"]):
			continue
		ents[D.MACHINE_SLOTS[m["slot"]]] = {"type": "machine", "id": m["id"]}
	_place_line(ents, state.visitors_at("창구"), D.COUNTER_QUEUE)
	_place_line(ents, state.visitors_at("출고대기"), D.PICKUP_SPOTS)
	return ents


func _place_line(ents: Dictionary, people: Array, spots: Array) -> void:
	for i in mini(people.size(), spots.size()):
		ents[spots[i]] = {"type": "visitor", "id": people[i]["id"]}


# ───────────────────────── 그리기 ─────────────────────────

func _draw() -> void:
	if map_rows.is_empty() or state == null:
		return
	var view := _visible_tiles()
	var trucks: Array = []
	for y in range(view.position.y, view.end.y):
		var row: String = map_rows[y]
		for x in range(view.position.x, view.end.x):
			_draw_tile(Vector2i(x, y), row[x])
			if row[x] == "K" and tile_char(Vector2i(x - 1, y)) != "K":
				trucks.append(Vector2(x * T, y * T))
	# 트럭은 두 칸짜리라 바닥을 다 그린 뒤에 올린다
	for p in trucks:
		_truck(p)

	# 위에 있는 것부터 그려야 아래 것이 앞을 가린다
	var items: Array = []
	var ents := entities()
	for t in ents:
		items.append([float(t.y), t, ents[t]])
	items.append([player_pos.y / T + 0.5, player_tile, {"type": "player"}])
	items.sort_custom(func(a, b): return a[0] < b[0])
	for it in items:
		_draw_entity(it[1], it[2])


func _visible_tiles() -> Rect2i:
	var vp := get_viewport_rect().size
	var center := _camera.get_screen_center_position()
	var x0 := maxi(0, floori((center.x - vp.x / 2) / T) - 1)
	var y0 := maxi(0, floori((center.y - vp.y / 2) / T) - 1)
	var x1 := mini(map_rows[0].length(), ceili((center.x + vp.x / 2) / T) + 1)
	var y1 := mini(map_rows.size(), ceili((center.y + vp.y / 2) / T) + 1)
	return Rect2i(x0, y0, x1 - x0, y1 - y0)


func _draw_tile(t: Vector2i, c: String) -> void:
	var p := Vector2(t * T)
	var r := Rect2(p, Vector2(T, T))
	var noise := (t.x * 73856093) ^ (t.y * 19349663)
	match c:
		",":
			_grass(r, noise)
		"t":
			_grass(r, noise)
			draw_rect(Rect2(p + Vector2(T * 0.42, T * 0.55), Vector2(T * 0.16, T * 0.4)), Color("6b4a2b"))
			draw_circle(p + Vector2(T * 0.5, T * 0.42), T * 0.42, Color("3f7a3a"))
			draw_circle(p + Vector2(T * 0.4, T * 0.32), T * 0.18, Color("4f8f45"))
		"#":
			draw_rect(r, Color("8a7a68"))
			draw_rect(Rect2(p, Vector2(T, T * 0.25)), Color("a89880"))
			draw_rect(Rect2(p + Vector2(0, T - 4), Vector2(T, 4)), Color("6e604f"))
		".", "C", "P", "M", "T", "L", "B":
			draw_rect(r, Color("e8dcc0"))
			draw_rect(r, Color("d6c9aa"), false, 1.0)
			_furniture(p, c)
		"D":
			draw_rect(r, Color("e8dcc0"))
			draw_rect(Rect2(p + Vector2(4, 4), Vector2(T - 8, T - 8)), Color("b98a5a"))
		"w":
			draw_rect(r, Color("b9b9b4"))
			draw_rect(r, Color("a5a5a0"), false, 1.0)
		":":
			draw_rect(r, Color("d8c89e"))
			for i in 4:
				var h := absi(noise >> (i * 5)) % (T * T)
				draw_circle(p + Vector2(h % T, floori(h / float(T))), 1.5, Color("b8a57a"))
		"=", "K":
			draw_rect(r, Color("5d5d61"))
		"f":
			_grass(r, noise)
			draw_rect(Rect2(p + Vector2(0, T * 0.35), Vector2(T, 5)), Color("8a6a45"))
			draw_rect(Rect2(p + Vector2(0, T * 0.6), Vector2(T, 5)), Color("8a6a45"))
			draw_rect(Rect2(p + Vector2(T * 0.4, T * 0.2), Vector2(7, T * 0.65)), Color("6b4a2b"))
		"~":
			draw_rect(r, Color("7aa04a"))
			for i in 3:
				var y := p.y + 8 + i * 14
				draw_line(Vector2(p.x + 3, y), Vector2(p.x + T - 3, y), Color("4f7a2f"), 4.0)
		"S":
			_grass(r, noise)
			draw_rect(Rect2(p + Vector2(T * 0.45, T * 0.5), Vector2(5, T * 0.45)), Color("6b4a2b"))
			draw_rect(Rect2(p + Vector2(6, 8), Vector2(T - 12, T * 0.45)), Color("f4efe2"))
			draw_rect(Rect2(p + Vector2(6, 8), Vector2(T - 12, T * 0.45)), Color("6b4a2b"), false, 2.0)
		"H":
			draw_rect(r, Color("8a7a68"))
			draw_rect(Rect2(p + Vector2(10, 10), Vector2(T - 20, T - 10)), Color("6b4a2b"))
		_:
			_grass(r, noise)


func _grass(r: Rect2, noise: int) -> void:
	draw_rect(r, Color("86b960"))
	for i in 3:
		var h := absi(noise >> (i * 6)) % (T * T)
		var q := r.position + Vector2(h % T, floori(h / float(T)))
		draw_line(q, q + Vector2(2, -5), Color("6d9e4a"), 2.0)


func _furniture(p: Vector2, c: String) -> void:
	var wood := Color("a0703c")
	match c:
		"C": # 창구
			draw_rect(Rect2(p + Vector2(0, 8), Vector2(T, T - 16)), wood)
			draw_rect(Rect2(p + Vector2(0, 8), Vector2(T, 6)), wood.lightened(0.25))
		"P": # 컴퓨터
			draw_rect(Rect2(p + Vector2(2, 14), Vector2(T - 4, T - 20)), wood)
			draw_rect(Rect2(p + Vector2(10, 2), Vector2(T - 20, 20)), Color("333"))
			draw_rect(Rect2(p + Vector2(13, 5), Vector2(T - 26, 14)), Color("5a9ad6"))
		"M": # 내 자리
			draw_rect(Rect2(p + Vector2(2, 14), Vector2(T - 4, T - 20)), wood)
			draw_rect(Rect2(p + Vector2(T - 18, 6), Vector2(10, 12)), Color("f4f4f4"))
			draw_rect(Rect2(p + Vector2(8, 18), Vector2(14, 10)), Color("fff7a8"))
		"T": # 전화기
			var ringing: bool = not state.ringing.is_empty()
			if ringing and fmod(_clock, 0.5) < 0.25:
				draw_circle(p + Vector2(T, T) / 2, T * 0.48, Color(1, 0.85, 0.2, 0.6))
			draw_rect(Rect2(p + Vector2(6, 18), Vector2(T - 12, T - 22)), wood)
			draw_rect(Rect2(p + Vector2(13, 10), Vector2(T - 26, 12)), Color("c8402f"))
			if ringing:
				_bubble(p + Vector2(T / 2.0, -4), "!")
		"L": # 팀장 책상
			draw_rect(Rect2(p + Vector2(0, 10), Vector2(T, T - 16)), wood.darkened(0.15))
			draw_rect(Rect2(p + Vector2(4, 14), Vector2(16, 12)), Color("f4f4f4"))
		"B": # 서류함
			draw_rect(Rect2(p + Vector2(4, 2), Vector2(T - 8, T - 6)), Color("7d8590"))
			for i in 3:
				draw_line(p + Vector2(6, 14 + i * 12), p + Vector2(T - 6, 14 + i * 12), Color("5d6570"), 2.0)


func _truck(p: Vector2) -> void:
	# 두 칸짜리 1톤 트럭 (왼쪽 짐칸, 오른쪽 운전석)
	draw_rect(Rect2(p + Vector2(4, T - 10), Vector2(T * 2 - 8, 6)), Color(0, 0, 0, 0.25))
	draw_rect(Rect2(p + Vector2(4, 10), Vector2(T * 1.15, T - 20)), Color("d9d9d9"))
	draw_rect(Rect2(p + Vector2(4, 10), Vector2(T * 1.15, T - 20)), Color("8a8a8a"), false, 2.0)
	draw_rect(Rect2(p + Vector2(T * 1.2, 6), Vector2(T * 0.75, T - 16)), Color("2f5f9a"))
	draw_rect(Rect2(p + Vector2(T * 1.55, 10), Vector2(T * 0.3, 12)), Color("bfe0ff"))
	for wx in [T * 0.4, T * 1.55]:
		draw_circle(p + Vector2(wx, T - 8), 7, Color("222"))
	_label(p + Vector2(T, -2), "트럭", 12)


func _draw_entity(t: Vector2i, e: Dictionary) -> void:
	var bottom := Vector2(t * T) + Vector2(T / 2.0, T - 4)
	match e["type"]:
		"player":
			var bob := sin(_t * PI) * 3.0 if _moving else 0.0
			_person(player_pos + Vector2(T / 2.0, T - 4 - bob), Color("2f4f7a"), "player", facing)
		"leader":
			_person(bottom, Color("6a6a70"), "leader", Vector2i.DOWN)
			_label(bottom + Vector2(0, -T - 4), D.LEADER, 12)
			if state.leader_has_words():
				_bubble(bottom + Vector2(0, -T - 22), "!")
		"visitor":
			var v: Dictionary = state.visitor_of(e["id"])
			if v.is_empty():
				return
			_person(bottom, Color("7a8f5a"), "farmer", _visitor_facing(v))
			var left: int = state.visitor_patience(v)
			_label(bottom + Vector2(0, -T - 4), "%s 님" % v["farmer"], 12)
			if not v["serving"]:
				_patience_bar(bottom + Vector2(0, -T + 2), left / float(D.VISITOR_PATIENCE))
		"machine":
			var m: Dictionary = state.machine_of(e["id"])
			if not m.is_empty():
				_machine(Vector2(t * T), m["type"], m["name"], m["status"])
		"job_machine":
			var type := _trip_type()
			_machine(Vector2(t * T), type, state.trip.get("machine", "농기계"), "대기" if state.trip.get("fixed", false) else "고장")
			if not state.trip.get("fixed", false):
				for i in 3:
					var k := fmod(_clock * 0.8 + i * 0.33, 1.0)
					draw_circle(Vector2(t * T) + Vector2(T * 0.7 + k * 6, 10 - k * 26), 4 + k * 6, Color(0.4, 0.4, 0.4, 0.6 - k * 0.6))
		"job_farmer":
			_person(bottom, Color("7a8f5a"), "farmer", Vector2i.DOWN)
			_label(bottom + Vector2(0, -T - 4), "%s 님" % state.trip.get("farmer", ""), 12)
			if not state.trip.get("fixed", false):
				_bubble(bottom + Vector2(0, -T - 22), "!")


func _visitor_facing(v: Dictionary) -> Vector2i:
	return Vector2i.UP if v["stage"] == "창구" else Vector2i.DOWN


func _trip_type() -> String:
	var machine: String = state.trip.get("machine", "")
	for type in D.MACHINE_COLORS:
		if machine.begins_with(type):
			return type
	return ""


func _person(bottom: Vector2, body: Color, kind: String, dir: Vector2i) -> void:
	# 그림자
	draw_set_transform(bottom, 0.0, Vector2(1.0, 0.35))
	draw_circle(Vector2.ZERO, 13, Color(0, 0, 0, 0.25))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# 다리, 몸, 머리
	draw_rect(Rect2(bottom + Vector2(-8, -10), Vector2(6, 10)), Color("3a3a3a"))
	draw_rect(Rect2(bottom + Vector2(2, -10), Vector2(6, 10)), Color("3a3a3a"))
	draw_rect(Rect2(bottom + Vector2(-11, -26), Vector2(22, 17)), body)
	var head := bottom + Vector2(0, -33)
	draw_circle(head, 9, SKIN)
	match kind:
		"player": # 모자 쓴 신규 주무관
			draw_rect(Rect2(head + Vector2(-10, -11), Vector2(20, 7)), Color("1f3a5f"))
			draw_rect(Rect2(head + Vector2(-4 + dir.x * 6, -6), Vector2(8, 3)), Color("1f3a5f"))
			draw_rect(Rect2(bottom + Vector2(-3, -24), Vector2(6, 4)), Color("f2d24b")) # 명찰
		"farmer": # 밀짚모자
			draw_set_transform(head + Vector2(0, -6), 0.0, Vector2(1.0, 0.35))
			draw_circle(Vector2.ZERO, 16, Color("e6c86e"))
			draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
			draw_circle(head + Vector2(0, -9), 7, Color("d9b65a"))
		"leader": # 흰머리, 안경
			draw_rect(Rect2(head + Vector2(-9, -10), Vector2(18, 6)), Color("c9c9c9"))
			draw_rect(Rect2(head + Vector2(-7, -2), Vector2(14, 4)), Color("222"), false, 1.5)
			draw_rect(Rect2(bottom + Vector2(-2, -26), Vector2(4, 12)), Color("8b2f2f")) # 넥타이
	if dir == Vector2i.UP:
		return
	var eye := Color("222")
	if dir == Vector2i.DOWN:
		draw_circle(head + Vector2(-3, 1), 1.6, eye)
		draw_circle(head + Vector2(3, 1), 1.6, eye)
	else:
		draw_circle(head + Vector2(dir.x * 4, 1), 1.6, eye)


func _machine(p: Vector2, type: String, mname: String, status: String) -> void:
	var col: Color = D.MACHINE_COLORS.get(type, Color("6a7f95"))
	draw_rect(Rect2(p + Vector2(4, T - 9), Vector2(T - 8, 6)), Color(0, 0, 0, 0.25))
	draw_rect(Rect2(p + Vector2(5, 16), Vector2(T - 10, T - 28)), col)
	draw_rect(Rect2(p + Vector2(T * 0.5, 7), Vector2(T * 0.3, 12)), col.darkened(0.35))
	draw_rect(Rect2(p + Vector2(8, 18), Vector2(T * 0.3, 5)), col.lightened(0.3))
	draw_circle(p + Vector2(12, T - 11), 7, Color("2b2b2b"))
	draw_circle(p + Vector2(T - 12, T - 12), 9, Color("2b2b2b"))
	draw_circle(p + Vector2(T - 12, T - 12), 3, Color("888"))
	_label(p + Vector2(T / 2.0, 2), mname.replace("(임대)", ""), 11)
	match status:
		"고장":
			_bubble(p + Vector2(T - 6, 6), "!", Color("c8402f"))
		"정비중", "점검중":
			_bubble(p + Vector2(T - 6, 6), "…", Color("e08a2c"))


func _patience_bar(center: Vector2, ratio: float) -> void:
	ratio = clampf(ratio, 0.0, 1.0)
	var w := 30.0
	draw_rect(Rect2(center + Vector2(-w / 2, 0), Vector2(w, 5)), Color(0, 0, 0, 0.5))
	var col := Color("5fb04a") if ratio > 0.5 else (Color("e0a02c") if ratio > 0.25 else Color("d0402f"))
	draw_rect(Rect2(center + Vector2(-w / 2, 0), Vector2(w * ratio, 5)), col)


func _bubble(center: Vector2, mark: String, col := Color("d0402f")) -> void:
	var y := sin(_clock * 6.0) * 2.0
	draw_circle(center + Vector2(0, y), 10, Color.WHITE)
	draw_arc(center + Vector2(0, y), 10, 0.0, TAU, 24, col, 2.0)
	_text_centered(center + Vector2(0, y + 6), mark, 15, col)


func _label(center: Vector2, s: String, size: int) -> void:
	if font == null:
		return
	var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	draw_rect(Rect2(center.x - w / 2 - 4, center.y - size - 2, w + 8, size + 6), Color(0, 0, 0, 0.55))
	draw_string(font, Vector2(center.x - w / 2, center.y + 1), s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color.WHITE)


func _text_centered(baseline_center: Vector2, s: String, size: int, col: Color) -> void:
	if font == null:
		return
	var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	draw_string(font, Vector2(baseline_center.x - w / 2, baseline_center.y), s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)
