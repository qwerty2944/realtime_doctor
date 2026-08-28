#!/usr/bin/env node
// 스테이징/운영 데이터베이스 도구 — 마이그레이션 적용 · 구조 지문 · 권한 감사.
//
// 왜 psql 이 아니라 Management API 인가
// ------------------------------------
// 이 레포의 원격 마이그레이션 이력은 파일 번호와 어긋나 있어서 `supabase db push`
// 를 쓸 수 없다 (STATE.md 의 A1 배포 기록 참고). 그리고 이 머신에는 psql 이 없다.
// Management API 의 query 엔드포인트는 문장 전체를 **하나의 트랜잭션**으로 돌리므로
// 실패한 마이그레이션이 절반만 남는 일이 없다 — 실제로 0000 이 storage.buckets 부재로
// 실패했을 때 public 테이블 0개로 깨끗하게 되돌아가는 것을 확인했다.
//
// 필요한 것: SUPABASE_ACCESS_TOKEN (supabase login 이 넣어주는 값과 동일)
//
// 사용법:
//   node scripts/staging/db.mjs apply       <project-ref>   # 0000..NNNN 순서대로 적용
//   node scripts/staging/db.mjs fingerprint <project-ref>   # 구조 지문을 stdout 으로
//   node scripts/staging/db.mjs audit       <project-ref>   # 0013 권한 감사 (verdict 포함)
//   node scripts/staging/db.mjs inventory   <project-ref>   # 테이블 · RLS · 정책 수 · 행 수
//
// 두 프로젝트 비교:
//   node scripts/staging/db.mjs fingerprint yhwvwojjwwlcrvpfxgag > /tmp/prod.txt
//   node scripts/staging/db.mjs fingerprint ywsdxnpilcesudtyrewt > /tmp/staging.txt
//   diff -u /tmp/prod.txt /tmp/staging.txt

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const MIGRATIONS = join(REPO, 'supabase', 'migrations');
const AUDIT_FILE = join(REPO, 'supabase', 'audit', 'named-role-privileges.sql');

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN 이 없다. `supabase login` 후 다시 실행할 것.');
  process.exit(1);
}

/** Management API 로 SQL 을 한 트랜잭션으로 실행한다. */
async function query(ref, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      // Cloudflare 가 기본 User-Agent 를 1010 으로 막는다.
      'User-Agent': 'curl/8.7.1'
    },
    body: JSON.stringify({ query: sql })
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(text);
    err.httpStatus = res.status;
    throw err;
  }
  return JSON.parse(text);
}

/**
 * 구조 지문. 한 줄에 객체 하나. 정렬돼 있으므로 두 프로젝트의 출력을 그대로
 * diff 하면 스키마 차이가 나온다.
 *
 * 무엇을 보는가: 컬럼 · 테이블(+RLS 플래그) · 함수(+SECURITY DEFINER) · 정책 ·
 * 인덱스 · 제약 · 트리거(public + auth) · 테이블 GRANT · 함수 GRANT · 확장 ·
 * 시퀀스 · enum · 기본 권한(pg_default_acl).
 *
 * 무엇을 보지 않는가: 행 데이터(의도적 — 운영 PHI 를 읽지 않는다), storage 버킷,
 * Auth 설정, Edge Function. 그것들은 이 파일이 답할 수 있는 질문이 아니다.
 */
const FINGERPRINT_SQL = `
with
cols as (
  select 'COLUMN  '||table_name||'.'||column_name||' :: '||data_type||
         coalesce(' len='||character_maximum_length,'')||
         ' null='||is_nullable||' default='||coalesce(column_default,'-') as line
  from information_schema.columns where table_schema='public'
),
tabs as (
  select 'TABLE   '||c.relname||' kind='||c.relkind::text||' rls='||c.relrowsecurity||' force='||c.relforcerowsecurity as line
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','v','m','p')
),
funs as (
  select 'FUNC    '||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') secdef='||p.prosecdef||
         ' vol='||p.provolatile::text||' lang='||l.lanname||' ret='||pg_get_function_result(p.oid) as line
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='public'
),
pols as (
  select 'POLICY  '||tablename||'.'||policyname||' cmd='||cmd||' perm='||permissive||
         ' roles='||array_to_string(roles,',')||' using='||coalesce(qual,'-')||' check='||coalesce(with_check,'-') as line
  from pg_policies where schemaname='public'
),
idxs as (select 'INDEX   '||indexname||' = '||indexdef as line from pg_indexes where schemaname='public'),
cons as (
  select 'CONSTR  '||rel.relname||'.'||con.conname||' '||pg_get_constraintdef(con.oid) as line
  from pg_constraint con join pg_class rel on rel.oid=con.conrelid
  join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public'
),
trgs as (
  select 'TRIGGER '||c.relname||'.'||t.tgname||' '||pg_get_triggerdef(t.oid) as line
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal
),
atrgs as (
  -- auth.users 의 가입 트리거 2종. public 밖이지만 이 앱의 핵심 배선이라 뺄 수 없다.
  select 'ATRIG   '||c.relname||'.'||t.tgname||' '||pg_get_triggerdef(t.oid) as line
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='auth' and not t.tgisinternal
),
tgrants as (
  select 'GRANT-T '||table_name||' '||grantee||' '||privilege_type as line
  from information_schema.role_table_grants where table_schema='public'
),
fgrants as (
  select 'GRANT-F '||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||
         coalesce(r.rolname,'PUBLIC')||' '||a.privilege_type as line
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_roles r on r.oid=a.grantee
  where n.nspname='public'
),
exts as (select 'EXT     '||extname||' '||extversion||' schema='||n.nspname as line
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
seqs as (select 'SEQ     '||sequence_name as line from information_schema.sequences where sequence_schema='public'),
types as (select 'ENUM    '||t.typname||' = '||string_agg(e.enumlabel,',' order by e.enumsortorder) as line
  from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
  where n.nspname='public' group by t.typname),
dacl as (select 'DEFACL  '||coalesce(r.rolname,'?')||' '||coalesce(dn.nspname,'-')||' '||d.defaclobjtype::text||' '||coalesce(d.defaclacl::text,'-') as line
  from pg_default_acl d left join pg_roles r on r.oid=d.defaclrole left join pg_namespace dn on dn.oid=d.defaclnamespace)
select line from (
  select line from cols union all select line from tabs union all select line from funs
  union all select line from pols union all select line from idxs union all select line from cons
  union all select line from trgs union all select line from atrgs union all select line from tgrants
  union all select line from fgrants union all select line from exts union all select line from seqs
  union all select line from types union all select line from dacl
) x order by 1;
`;

const INVENTORY_SQL = `
select c.relname as name,
       c.relrowsecurity as rls,
       (select count(*) from pg_policy p where p.polrelid=c.oid) as policies,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I',c.relname),false,true,'')))[1]::text::int as rows
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by 1;
`;

/**
 * 감사 파일에서 SQL 조각을 뽑는다.
 *
 * `supabase/audit/named-role-privileges.sql` 은 psql 용이라 `\\echo` 메타명령이
 * 섞여 있다. 여기서 **다시 쓰지 않고** 그 파일을 읽어 메타명령만 걷어낸다 —
 * 기준을 두 벌로 만들면 갈라지고, 갈라진 감사는 엉뚱한 이유로 통과한다
 * (0013 의 allowlist 를 감사 파일이 자체 복사하지 않는 것과 같은 이유).
 */
function auditStatements() {
  const raw = readFileSync(AUDIT_FILE, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('\\'))
    .join('\n');
  // do $$ ... $$; 블록과 select 문을 최상위 세미콜론 기준으로 자른다.
  const parts = [];
  let buf = '';
  let inDollar = false;
  for (const line of raw.split('\n')) {
    if (/\$\$/.test(line)) {
      const marks = (line.match(/\$\$/g) || []).length;
      if (marks % 2 === 1) inDollar = !inDollar;
    }
    buf += line + '\n';
    if (!inDollar && /;\s*$/.test(line)) {
      if (buf.replace(/--.*$/gm, '').trim()) parts.push(buf);
      buf = '';
    }
  }
  return parts;
}

async function main() {
  const [cmd, ref] = process.argv.slice(2);
  if (!cmd || !ref) {
    console.error('usage: db.mjs <apply|fingerprint|audit|inventory> <project-ref>');
    process.exit(1);
  }

  if (cmd === 'apply') {
    const files = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort();
    for (const f of files) {
      const version = f.slice(0, 4);
      try {
        await query(ref, readFileSync(join(MIGRATIONS, f), 'utf8'));
      } catch (err) {
        console.log(`[FAIL] ${f}`);
        console.log(`       ${err.message.slice(0, 1200)}`);
        // 한 트랜잭션이므로 이 파일은 통째로 롤백됐다. 다음 파일은 이 파일을
        // 전제하므로 계속 가면 무의미한 실패가 줄줄이 난다.
        process.exit(1);
      }
      // 이력표. 원격 이력이 파일 번호와 맞지 않는 것이 이 레포의 기존 문제라
      // (STATE.md), 새 데이터베이스에서는 처음부터 파일 번호로 맞춰 둔다.
      await query(
        ref,
        `create schema if not exists supabase_migrations;
         create table if not exists supabase_migrations.schema_migrations
           (version text primary key, statements text[], name text);
         insert into supabase_migrations.schema_migrations(version, name)
         values ('${version}', '${f.replace(/\.sql$/, '')}') on conflict do nothing;`
      );
      console.log(`[OK  ] ${f}`);
    }
    console.log(`\n${files.length} migrations applied to ${ref}.`);
    return;
  }

  if (cmd === 'fingerprint') {
    const rows = await query(ref, FINGERPRINT_SQL);
    for (const r of rows) console.log(r.line);
    return;
  }

  if (cmd === 'inventory') {
    const rows = await query(ref, INVENTORY_SQL);
    console.log('table'.padEnd(34), 'rls'.padEnd(6), 'pol'.padEnd(4), 'rows');
    for (const r of rows) {
      console.log(String(r.name).padEnd(34), String(r.rls).padEnd(6), String(r.policies).padEnd(4), r.rows);
    }
    console.log(`\n${rows.length} tables, ${rows.reduce((a, r) => a + r.rows, 0)} rows total.`);
    return;
  }

  if (cmd === 'audit') {
    const parts = auditStatements();
    let failed = false;
    for (const [i, sql] of parts.entries()) {
      try {
        const rows = await query(ref, sql);
        const head = sql.replace(/--.*$/gm, '').trim().slice(0, 60).replace(/\s+/g, ' ');
        console.log(`--- statement ${i + 1}: ${head}… -> ${rows.length} row(s)`);
        for (const r of rows) console.log('    ' + JSON.stringify(r));
      } catch (err) {
        console.log(`--- statement ${i + 1}: RAISED`);
        console.log('    ' + err.message.slice(0, 800));
        failed = true;
      }
    }
    console.log(failed ? '\nVERDICT: FAIL' : '\nVERDICT: PASS (권한 위반 0건)');
    process.exit(failed ? 1 : 0);
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
