const ko = {
  // common
  'common.cancel': '취소',
  'common.save': '저장',
  'common.reset': '기본값으로',
  'common.close': '닫기',
  'common.loading': '불러오는 중…',
  'common.minimize': '최소화',
  'common.opacity': '투명도',
  'common.start': '시작',
  'common.stop': '정지',

  // window titles
  'window.transcript': '전사',
  'window.diagnosis': '감별진단',
  'window.terms': '의학용어',
  'window.questions': '다음 질문',
  'window.summary': '요약',
  'window.dictation': '받아쓰기',

  // dock
  'dock.account': '계정',
  'dock.signIn': '로그인',
  'dock.signUp': '회원가입',
  'dock.signOut': '로그아웃',
  'dock.email': '이메일',
  'dock.password': '비밀번호',
  'dock.passwordConfirm': '비밀번호 확인',
  'dock.toggleAll': '전체 창 보이기/숨기기',
  'dock.shortcutsTitle': '단축키 설정',
  'dock.shortcutsHint': '전역 단축키 — 앱이 백그라운드여도 동작합니다. 행을 클릭하여 키 조합을 다시 누르세요.',
  'dock.languageTitle': '언어',
  'dock.languageHintKo': '한국어 → CLOVA 실시간 전사를 사용합니다.',
  'dock.languageHintEn': '영어 → OpenAI Realtime 전사를 사용합니다.',
  'dock.languageFallback': 'Gemini 는 실시간 전사가 실패했을 때만 자동으로 사용됩니다.',
  'dock.layoutsTitle': '레이아웃',
  'dock.layoutSave': '현재 레이아웃 저장',
  'dock.layoutDefault': '기본으로 지정',
  'dock.layoutDelete': '삭제',

  // language picker (first launch)
  'picker.title': '언어를 선택하세요 / Choose language',
  'picker.subtitle': '한국어 → CLOVA, 영어 → OpenAI Realtime. Gemini 는 실패 시 자동 폴백.',
  'picker.ko': '🇰🇷 한국어',
  'picker.en': '🇺🇸 English',

  // transcript
  'transcript.empty': '아직 발화가 없습니다.',
  'transcript.fallbackBanner': '실시간 전사 실패 — Gemini 청크 모드로 전환되었습니다.',
  'transcript.recording': '녹음 중',
  'transcript.paused': '일시정지',
  'transcript.modeStream': '실시간',
  'transcript.modeChunk': '청크',
  'transcript.speakerDoctor': '의사',
  'transcript.speakerPatient': '환자',
  'transcript.speakerUnknown': '?',

  // summary
  'summary.run': '새로 생성',
  'summary.statusIdle': '대기 중',
  'summary.statusPending': '생성 중…',
  'summary.statusError': '오류',
  'summary.chiefComplaint': '주호소',
  'summary.hpi': '현병력',
  'summary.findings': '주요 소견',
  'summary.investigations': '검사',
  'summary.impression': '임상 인상',
  'summary.plan': '계획',

  // dictation
  'dictation.run': '새로 생성',
  'dictation.statusIdle': '대기 중',
  'dictation.statusPending': '생성 중…',
  'dictation.statusError': '오류',
  'dictation.templateSoap': 'SOAP',
  'dictation.templateApso': 'APSO',
  'dictation.templateHp': 'H&P',
  'dictation.templateNarrative': '서술형',

  // diagnosis
  'diagnosis.empty': '아직 감별진단이 없습니다.',
  'diagnosis.confidence': '가능성',
  'diagnosis.reasoning': '근거',

  // terms
  'terms.empty': '아직 의학용어가 없습니다.',
  'terms.context': '인용',

  // questions
  'questions.empty': '아직 추천 질문이 없습니다.',
  'questions.rationale': '근거'
} as const;

export default ko;
