/**
 * zod -> 프로바이더 도구 스키마 변환.
 *
 * zod 가 모든 도구 형태의 단일 진실로 남는다. 이 파일은 스키마를 손으로
 * 기술하지 않는다 — 나중에 결과를 검증하는 바로 그 `z.ZodType` 을 기계적으로
 * 번역해서 모델에 먹인다. 그래서 스키마를 바꿔도 "모델에게 시킨 형태" 와
 * "검증하는 형태" 가 어긋날 수 없다.
 */

import { z } from 'zod';

/** JSON Schema 객체. 두 타깃 모두 우리가 벗겨낼 여분 키를 허용하므로 느슨하게 둔다. */
export type JsonSchemaObject = Record<string, unknown>;

/**
 * zod 스키마를 JSON Schema 로 변환한다.
 *
 * `io: 'input'` 이다(`'output'` 이 아니라). 도구 입력은 *모델이* 쓰는 것이므로
 * 정의상 스키마의 입력 쪽이다. 출력 쪽은 zod 가 돌고 난 뒤 앱이 보는 것이다.
 */
export function zodToJsonSchema(schema: z.ZodType): JsonSchemaObject {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    // 반복되는 서브스키마를 인라인한다: 어느 프로바이더도 `$defs` 의 `$ref` 를
    // 안정적으로 풀지 못하고, 이 스키마들은 중복돼도 부담이 없을 만큼 작다.
    reused: 'inline',
    cycles: 'throw'
  }) as JsonSchemaObject;

  if (jsonSchema.type !== 'object') {
    throw new Error('Tool input schemas must describe an object.');
  }

  // `$schema` 는 JSON Schema 도구에는 의미가 있지만 모델 API 에는 잡음이다.
  const result = { ...jsonSchema };
  delete result.$schema;
  return result;
}

/**
 * Gemini 의 OpenAPI 3.0 부분집합이 `functionDeclarations.parameters` 에서
 * 받아들이는 키. 나머지는 {@link toGeminiSchema} 가 버린다.
 *
 * 일부러 빠져 있는 것들:
 *   - `additionalProperties` — API 가 그대로 거절한다
 *   - `$ref` / `$defs` — 우리는 인라인한다
 *   - `const`, `allOf`, `oneOf`, `not`, `exclusiveMinimum/Maximum`, `uniqueItems`
 */
const GEMINI_ALLOWED_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'anyOf',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'pattern',
  'default',
  'propertyOrdering'
]);

/**
 * Gemini 가 인식하는 `format` 값(타입별). 모르는 format 은 경고가 아니라
 * 400 이므로, 이 집합 밖은 버린다 — 제약은 모델에 주는 힌트일 뿐이고,
 * 힌트를 잃는 것은 견딜 수 있지만 요청을 통째로 잃는 것은 아니다.
 */
const GEMINI_ALLOWED_FORMATS: Record<string, ReadonlySet<string>> = {
  string: new Set(['enum', 'date-time']),
  number: new Set(['float', 'double']),
  integer: new Set(['int32', 'int64'])
};

/**
 * JSON Schema 를 Gemini 의 OpenAPI 부분집합으로 번역한다.
 *
 * 블랙리스트가 아니라 재귀적 화이트리스트다: 미래의 zod 가 새 키워드를
 * 들고 와도 400 으로 이어져 문진이 실패하는 대신 조용히 버려진다.
 *
 * 제거된 키도 함께 돌려주므로 호출자는 손실을 한 번만 로그로 남길 수 있다.
 */
export function toGeminiSchema(schema: JsonSchemaObject): {
  schema: JsonSchemaObject;
  dropped: string[];
} {
  const dropped = new Set<string>();

  function convert(node: unknown, path: string): unknown {
    if (Array.isArray(node)) return node.map((item, i) => convert(item, `${path}[${i}]`));
    if (node === null || typeof node !== 'object') return node;

    const source = node as JsonSchemaObject;
    const out: JsonSchemaObject = {};

    for (const [key, value] of Object.entries(source)) {
      // 화이트리스트보다 먼저 본다: $ref 를 버리면 제약 없는 속성이 남고,
      // 모델은 거기에 아무거나 채울 수 있다. 요청을 안 보내는 편이 낫다.
      if (key === '$ref') {
        throw new Error(
          `Gemini tool schema contains a $ref at ${path} ("${String(value)}"). Inline the subschema: Gemini does not resolve JSON Schema references.`
        );
      }

      if (!GEMINI_ALLOWED_KEYS.has(key)) {
        // `const` 는 진짜 의미(고정 리터럴)를 담으므로 단일값 enum 으로 보존한다.
        if (key === 'const') {
          out.enum = [value];
          continue;
        }
        dropped.add(`${path}.${key}`);
        continue;
      }

      if (key === 'properties' && value && typeof value === 'object') {
        const properties: JsonSchemaObject = {};
        for (const [name, child] of Object.entries(value as JsonSchemaObject)) {
          properties[name] = convert(child, `${path}.properties.${name}`);
        }
        out.properties = properties;
        continue;
      }

      if (key === 'format') {
        const type = typeof source.type === 'string' ? source.type : '';
        if (!GEMINI_ALLOWED_FORMATS[type]?.has(String(value))) {
          dropped.add(`${path}.format=${String(value)}`);
          continue;
        }
      }

      out[key] = convert(value, `${path}.${key}`);
    }

    return out;
  }

  const converted = convert(schema, '$') as JsonSchemaObject;
  assertGeminiSchemaUsable(converted);

  return { schema: converted, dropped: [...dropped] };
}

/**
 * Gemini 가 실행할 수 없는 변환 결과에서 크게 실패한다.
 *
 * 속성이 없는 객체는 API 가 그대로 받아들이고 빈 객체나 임의의 객체로 답한다 —
 * 조용한 임상적 실패다. 요청을 거부하는 편이 낫다.
 */
function assertGeminiSchemaUsable(schema: JsonSchemaObject): void {
  if (schema.type === 'object' && Object.keys((schema.properties ?? {}) as object).length === 0) {
    throw new Error(
      'Gemini tool schema converted to an object with no properties. The model would be free to return anything.'
    );
  }
}
