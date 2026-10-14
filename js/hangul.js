// 한글 자모 데이터: 오음 색 계열, 모음 블록 모양, 글자 조합, 단어 사전.
(function (root) {
  const Jamo = (root.Jamo = root.Jamo || {});

  // 훈민정음 오음(五音) — 발음 위치별 색 계열
  Jamo.GROUPS = {
    blue:   { name: '아음', desc: '어금닛소리', fill: '#3b7dd8', dark: '#24548f', consonants: ['ㄱ', 'ㅋ', 'ㄲ'] },
    red:    { name: '설음', desc: '혓소리',     fill: '#d9483b', dark: '#93281f', consonants: ['ㄴ', 'ㄷ', 'ㅌ', 'ㄸ', 'ㄹ'] },
    yellow: { name: '순음', desc: '입술소리',   fill: '#e8b323', dark: '#a07408', consonants: ['ㅁ', 'ㅂ', 'ㅍ', 'ㅃ'] },
    white:  { name: '치음', desc: '잇소리',     fill: '#f3ead8', dark: '#9c8f74', consonants: ['ㅅ', 'ㅈ', 'ㅊ', 'ㅆ', 'ㅉ'] },
    purple: { name: '후음', desc: '목구멍소리', fill: '#8a4fbf', dark: '#5b2c86', consonants: ['ㅇ', 'ㅎ'] },
  };
  Jamo.COLOR_ORDER = ['blue', 'red', 'yellow', 'white', 'purple'];

  Jamo.colorOf = function (c) {
    for (const k of Jamo.COLOR_ORDER) if (Jamo.GROUPS[k].consonants.includes(c)) return k;
    return null;
  };

  Jamo.DOUBLE = ['ㄲ', 'ㄸ', 'ㅃ', 'ㅆ', 'ㅉ'];
  Jamo.isDouble = (c) => Jamo.DOUBLE.includes(c);

  // 모음 블록 모양 — [dx, dy] 칸 목록. axis: 'v'는 상하, 'h'는 좌우 이동.
  // bar: 숫자를 그릴 기준 칸.
  Jamo.VOWELS = {
    'ㅣ': { axis: 'v', cells: [[0, 0], [0, 1], [0, 2]], bar: [0, 1] },
    'ㅏ': { axis: 'v', cells: [[0, 0], [0, 1], [0, 2], [1, 1]], bar: [0, 1] },
    'ㅓ': { axis: 'v', cells: [[1, 0], [1, 1], [1, 2], [0, 1]], bar: [1, 1] },
    'ㅑ': { axis: 'v', cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]], bar: [0, 1] },
    'ㅕ': { axis: 'v', cells: [[1, 0], [1, 1], [1, 2], [0, 0], [0, 2]], bar: [1, 1] },
    'ㅡ': { axis: 'h', cells: [[0, 0], [1, 0], [2, 0]], bar: [1, 0] },
    'ㅗ': { axis: 'h', cells: [[0, 1], [1, 1], [2, 1], [1, 0]], bar: [1, 1] },
    'ㅜ': { axis: 'h', cells: [[0, 0], [1, 0], [2, 0], [1, 1]], bar: [1, 0] },
    'ㅛ': { axis: 'h', cells: [[0, 1], [1, 1], [2, 1], [0, 0], [2, 0]], bar: [1, 1] },
    'ㅠ': { axis: 'h', cells: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1]], bar: [1, 0] },
  };

  // 회전 모음 짝 (ㅏ↔ㅓ, ㅗ↔ㅜ)
  Jamo.FLIP = { 'ㅏ': 'ㅓ', 'ㅓ': 'ㅏ', 'ㅗ': 'ㅜ', 'ㅜ': 'ㅗ', 'ㅑ': 'ㅕ', 'ㅕ': 'ㅑ', 'ㅛ': 'ㅠ', 'ㅠ': 'ㅛ' };

  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';

  // 0xAC00 + (초성×21 + 중성)×28 + 종성
  Jamo.compose = function (cho, jung, jong) {
    const c = CHO.indexOf(cho);
    const j = JUNG.indexOf(jung);
    if (c < 0 || j < 0) return cho + jung;
    return String.fromCharCode(0xac00 + (c * 21 + j) * 28 + (jong || 0));
  };

  // 받침 없는 글자로 만들 수 있는 단어 (프로토타입용 소사전)
  Jamo.WORDS = new Set([
    // 같은 모음끼리
    '가다', '나라', '바다', '사자', '하마', '가마', '자라', '마차', '아빠', '파다', '차다', '타다', '바나나', '아바타',
    '도로', '고모', '보도', '포도', '소포', '코코',
    '두부', '부부', '우주', '구두', '수수',
    '기지', '이리', '지리', '비비', '미지', '시기', '피리',
    '버터', '허허', '어서', '거저',
    '요요', '효도',
    '크다', '쓰다', '흐르다',
    // 모음이 섞인 단어
    '나무', '오리', '우리', '아기', '고기', '모자', '다리', '머리', '소리', '노루', '사다리', '바구니', '기차',
    '나비', '거미', '하루', '토끼', '오이', '지구', '가지', '두더지', '도토리', '자두', '우유', '여우',
    '부모', '이마', '바지', '치마', '모기', '파도', '구리', '나이', '아이', '오누이', '시소',
    '가수', 
  ]);

  // 기본 점수표
  Jamo.SCORE = { letter: 10, perSecond: 5 };
})(typeof globalThis !== 'undefined' ? globalThis : window);
