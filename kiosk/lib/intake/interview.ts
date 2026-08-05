import 'server-only';

/**
 * 문진 대화 루프. SERVER ONLY.
 *
 * 종료는 모델이 결정하지만(3~5개 감별진단을 낼 수 있게 되면 `done`), 서버가
 * MAX_INTAKE_TURNS 로 그 위에 상한을 씌운다.
 *
 * ── 대화를 어디에 두는가 (righthand 와 다른 점) ──────────────────────────
 * righthand 는 매 턴을 `messages` 테이블에 append 했다. realtime_doctor 의
 * 0001 마이그레이션에는 그 테이블이 없다. 이번 라운드에 새 테이블을 추가하는
 * 대신, 대화는 **클라이언트가 들고 있다가 매 턴 통째로 되돌려 보낸다**.
 *
 * 트레이드오프를 분명히 해 두면:
 *   - 클라이언트는 자기 대화를 조작할 수 있다. 하지만 조작할 수 있는 것은
 *     "자기 증상을 뭐라고 말했는가" 뿐이고, 그건 원래 환자가 자유롭게 쓰는
 *     내용이다. 남의 진료에 쓸 수는 없다 — 토큰이 진료 id 와 담당 의사에
 *     묶여 있다.
 *   - 대화가 유실되면 안 되므로, 문진이 끝날 때 전문을
 *     `intake_results.soap_json.transcript` 에 함께 저장한다. 즉 의무기록
 *     측면의 영속성은 유지되고, 사라지는 것은 "미완료 문진의 중간 상태" 뿐이다
 *     (그건 어차피 의사가 볼 이유가 없다).
 *   - 요청 본문 크기는 `intakeTurnRequestSchema` 가 막는다.
 */

import { MAX_INTAKE_TURNS } from '@/lib/intake/limits';
import { callStructuredTool, type LlmMessage } from '@/lib/llm';
import {
  INTERVIEW_BOOTSTRAP_MESSAGE,
  INTERVIEW_FORCE_FINISH_MESSAGE,
  INTERVIEW_SYSTEM_PROMPT
} from '@/lib/intake/prompts';
import { interviewTurnSchema, type InterviewTurn } from '@/lib/intake/schemas';

const INTERVIEW_MAX_TOKENS = 1024;

/**
 * 한 턴에 허용되는 시도 횟수.
 *
 * 3번이고 더는 아니다: 매 시도가 환자를 태블릿 앞에 세워둔 채로 도는 왕복이고,
 * 실패 사유를 되돌려주며 두 번 무시한 모델이 네 번째에 순응하지는 않는다.
 */
const INTERVIEW_MAX_ATTEMPTS = 3;

export interface DialogueTurn {
  role: 'agent' | 'patient';
  text: string;
}

/**
 * 환자의 답변들을 순서대로, 각각 별개의 문자열로.
 *
 * red flag 매칭은 답변 사이의 경계가 필요하다. 한 답변 안에서 충족된 패턴과
 * 서로 무관한 두 답변에서 조립된 패턴은 의미가 다른데, 이어붙인 형태로는
 * 둘을 구별할 수 없다.
 */
export function collectPatientUtterances(turns: readonly DialogueTurn[]): string[] {
  return turns.filter((turn) => turn.role === 'patient').map((turn) => turn.text);
}

/** 에이전트가 이미 던진 질문 수. */
export function countAgentTurns(turns: readonly DialogueTurn[]): number {
  return turns.filter((turn) => turn.role === 'agent').length;
}

function toLlmMessages(turns: readonly DialogueTurn[], forceFinish: boolean): LlmMessage[] {
  // 대화는 에이전트 질문으로 열리지만 프로바이더는 첫 메시지가 user 이길
  // 요구한다. 부트스트랩 지시가 그 자리를 대신한다.
  const messages: LlmMessage[] = [{ role: 'user', content: INTERVIEW_BOOTSTRAP_MESSAGE }];

  for (const turn of turns) {
    messages.push({
      role: turn.role === 'agent' ? 'assistant' : 'user',
      content: turn.text
    });
  }

  if (forceFinish) {
    const last = messages[messages.length - 1];
    // 새 턴으로 밀어넣지 않고 마지막 user 턴에 덧붙여, 역할이 엄격히
    // 교대하도록 유지한다.
    if (last.role === 'user') {
      last.content = `${last.content}\n\n${INTERVIEW_FORCE_FINISH_MESSAGE}`;
    } else {
      messages.push({ role: 'user', content: INTERVIEW_FORCE_FINISH_MESSAGE });
    }
  }

  return messages;
}

/**
 * 모델에게 다음 문진 턴을 요청한다.
 *
 * `forceFinish` 는 일부러 두 번 적용된다: 마무리 문장이 자연스럽게 나오도록
 * 프롬프트에 힌트로, 그리고 힌트를 무시한 모델도 안전 상한을 넘기지 못하도록
 * 반환된 플래그에 덮어쓰기로.
 */
export async function runInterviewTurn(
  turns: readonly DialogueTurn[]
): Promise<InterviewTurn> {
  const forceFinish = countAgentTurns(turns) >= MAX_INTAKE_TURNS;

  const turn = await callStructuredTool({
    system: INTERVIEW_SYSTEM_PROMPT,
    messages: toLlmMessages(turns, forceFinish),
    toolName: 'record_intake_turn',
    toolDescription:
      'Record the next thing to say to the patient, whether the interview can now end, and whether the answers so far suggest an ophthalmic emergency.',
    schema: interviewTurnSchema,
    maxTokens: INTERVIEW_MAX_TOKENS,
    // 환자가 문진 도중 기다리고 있고 이 경로에는 상위 재시도가 없다.
    // 형식이 깨진 턴 하나가 접수처로 가라는 에러로 이어져서는 안 된다.
    maxAttempts: INTERVIEW_MAX_ATTEMPTS
  });

  return forceFinish ? { ...turn, done: true } : turn;
}
