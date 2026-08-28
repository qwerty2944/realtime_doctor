/**
 * 문진 흐름의 상한값.
 *
 * 모델 벤더와 무관한 정책이라 `lib/llm/` 밖에 둔다 — 모델을 바꿨다고 환자에게
 * 묻는 질문 수가 달라지면 안 된다.
 */

/** 문진 턴 하드 캡. */
export const MAX_INTAKE_TURNS = 15;

/**
 * 한 턴에 실려오는 대화 기록의 상한.
 *
 * 이 키오스크는 대화를 DB 에 쌓지 않고 클라이언트가 매 턴 통째로 다시 보낸다
 * (`lib/intake/interview.ts` 의 설명 참고). 그래서 본문 크기는 서버가 직접
 * 막아야 한다. agent/patient 를 합쳐 MAX_INTAKE_TURNS 의 2배 + 여유.
 */
export const MAX_DIALOGUE_TURNS = MAX_INTAKE_TURNS * 2 + 4;

/** 답변 한 개의 최대 길이(자). 음성 변환 결과도 이 안에 들어온다. */
export const MAX_ANSWER_LENGTH = 2000;
