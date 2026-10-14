// 레벨 데이터 — 6살 눈높이. map: 6줄×5칸, '.' 빈칸, 그 외 자음 타일.
// 레벨마다 그림 단어 하나(word)를 만든다. 순서대로 만들면 별 하나 더.
// blocks.pos는 모음 모양의 기준점(왼쪽 위) [x, y]. 모든 레벨은 tools/solve.js로 검증한다.
(function (root) {
  root.LEVELS = [
    // ── 1. 한 글자 ──
    {
      id: 1, world: 1, name: '코', emoji: '👃', word: '코', par: 1,
      tip: '파란 ㅗ를 오른쪽으로 쭉 밀어 봐요!',
      map: [
        '.....',
        '.....',
        '.....',
        '.....',
        '....ㅋ',
        '.....',
      ],
      blocks: [{ v: 'ㅗ', color: 'blue', pos: [0, 4], count: 1 }],
    },
    {
      id: 2, world: 1, name: '이', emoji: '🦷', word: '이', par: 1,
      tip: '보라 ㅣ를 아래로 쭉 내려 봐요!',
      map: [
        '.....',
        '.....',
        '.....',
        '.....',
        '.....',
        '.ㅇ...',
      ],
      blocks: [{ v: 'ㅣ', color: 'purple', pos: [0, 0], count: 1 }],
    },
    {
      id: 3, world: 1, name: '사자', emoji: '🦁', word: '사자', par: 2,
      tip: '자음 두 개를 모두 태워요. 위로 먼저, 그다음 아래로!',
      map: [
        'ㅅ....',
        '.....',
        '.....',
        '.....',
        '.....',
        'ㅈ....',
      ],
      blocks: [{ v: 'ㅏ', color: 'white', pos: [1, 1], count: 2 }],
    },

    // ── 2. 두 글자 ──
    {
      id: 4, world: 2, name: '바다', emoji: '🌊', word: '바다', par: 2,
      tip: '노란 ㅏ는 노란 ㅂ, 빨간 ㅏ는 빨간 ㄷ을 만나요.',
      map: [
        '..ㄷ..',
        '.....',
        '.....',
        '.....',
        '.....',
        'ㅂ....',
      ],
      blocks: [
        { v: 'ㅏ', color: 'yellow', pos: [0, 0], count: 1 },
        { v: 'ㅏ', color: 'red', pos: [3, 3], count: 1 },
      ],
    },
    {
      id: 5, world: 2, name: '나무', emoji: '🌳', word: '나무', par: 2,
      tip: 'ㅏ는 위아래로, ㅜ는 옆으로 움직여요.',
      map: [
        '.....',
        '.....',
        '.....',
        '.....',
        '.....',
        'ㄴㅁ...',
      ],
      blocks: [
        { v: 'ㅏ', color: 'red', pos: [0, 0], count: 1 },
        { v: 'ㅜ', color: 'yellow', pos: [2, 3], count: 1 },
      ],
    },
    {
      id: 6, world: 2, name: '오리', emoji: '🦆', word: '오리', par: 2,
      tip: '빨간 ㅣ가 막혔네요. 보라 ㅗ를 먼저 비켜 줘요.',
      map: [
        '.ㄹ...',
        '....ㅇ',
        '.....',
        '.....',
        '.....',
        '.....',
      ],
      blocks: [
        { v: 'ㅗ', color: 'purple', pos: [0, 1], count: 1 },
        { v: 'ㅣ', color: 'red', pos: [0, 3], count: 1 },
      ],
    },
    {
      id: 7, world: 2, name: '아기', emoji: '👶', word: '아기', par: 2,
      tip: '보라 ㅏ는 ㅇ, 파란 ㅣ는 ㄱ과 친구예요.',
      map: [
        '...ㄱ.',
        '.....',
        '.....',
        '.....',
        '.....',
        'ㅇ....',
      ],
      blocks: [
        { v: 'ㅏ', color: 'purple', pos: [0, 0], count: 1 },
        { v: 'ㅣ', color: 'blue', pos: [2, 3], count: 1 },
      ],
    },
    {
      id: 8, world: 2, name: '우유', emoji: '🥛', word: '우유', par: 2,
      tip: 'ㅜ와 ㅠ는 둘 다 보라색 ㅇ을 좋아해요.',
      map: [
        '.....',
        '....ㅇ',
        '.....',
        '.....',
        '.....',
        '....ㅇ',
      ],
      blocks: [
        { v: 'ㅜ', color: 'purple', pos: [0, 0], count: 1 },
        { v: 'ㅠ', color: 'purple', pos: [0, 3], count: 1 },
      ],
    },
    {
      id: 9, world: 2, name: '모자', emoji: '👒', word: '모자', par: 2,
      tip: 'ㅗ는 옆으로, ㅏ는 위로!',
      map: [
        'ㅁ....',
        '.....',
        '.ㅈ...',
        '.....',
        '.....',
        '.....',
      ],
      blocks: [
        { v: 'ㅗ', color: 'yellow', pos: [2, 0], count: 1 },
        { v: 'ㅏ', color: 'white', pos: [0, 3], count: 1 },
      ],
    },
    {
      id: 10, world: 2, name: '기차', emoji: '🚂', word: '기차', par: 2,
      tip: '기차 출발! 파란 ㅣ부터 움직여 볼까요?',
      map: [
        '.....',
        '.....',
        '.....',
        '.....',
        '.....',
        '.ㅊ.ㄱ.',
      ],
      blocks: [
        { v: 'ㅏ', color: 'white', pos: [0, 0], count: 1 },
        { v: 'ㅣ', color: 'blue', pos: [2, 0], count: 1 },
      ],
    },

    // ── 3. 자음 주머니 ──
    {
      id: 11, world: 3, name: '나비', emoji: '🦋', word: '나비', par: 2,
      tip: '위에 있는 주머니에서 자음이 하나씩 나와요.',
      map: [
        '.....',
        '.....',
        '.....',
        '.....',
        '.....',
        '.....',
      ],
      blocks: [
        { v: 'ㅏ', color: 'red', pos: [1, 2], count: 1 },
        { v: 'ㅣ', color: 'yellow', pos: [3, 3], count: 1 },
      ],
      pouches: [{ side: 'top', at: 2, queue: ['ㄴ', 'ㅂ'] }],
    },
    {
      id: 12, world: 3, name: '바나나', emoji: '🍌', word: '바나나', par: 2,
      tip: '빨간 ㅏ는 ㄴ을 두 개나 먹어야 해요.',
      map: [
        '.....',
        '.....',
        '.....',
        '.....',
        '.....',
        'ㅂ....',
      ],
      blocks: [
        { v: 'ㅏ', color: 'yellow', pos: [0, 0], count: 1 },
        { v: 'ㅏ', color: 'red', pos: [2, 3], count: 2 },
      ],
      pouches: [{ side: 'top', at: 1, queue: ['ㄴ', 'ㄴ'] }],
    },
  ];
})(typeof globalThis !== 'undefined' ? globalThis : window);
