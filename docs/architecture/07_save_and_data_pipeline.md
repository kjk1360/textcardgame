# 07. 세이브 & 데이터 파이프라인

두 가지 데이터 흐름:
1. **세이브 데이터** — 사용자 진행 상황 (런타임에 읽기/쓰기)
2. **콘텐츠 데이터** — 카드/적/이벤트 정의 (빌드 타임에 변환)

## 1. 세이브 시스템

### 저장 위치 (크로스 플랫폼)

```
Windows:  %APPDATA%\textcrawlergame\
macOS:    ~/Library/Application Support/textcrawlergame/
Linux:    ~/.local/share/textcrawlergame/
```

Node에서는 [`env-paths`](https://www.npmjs.com/package/env-paths) 라이브러리로 일괄 처리:
```typescript
import envPaths from 'env-paths';
const paths = envPaths('textcrawlergame', { suffix: '' });
const saveDir = paths.data;
```

### 파일 레이아웃

```
{saveDir}/
├── global.json                    # GlobalState
├── global.json.bak                # 직전 저장 백업
├── slots/
│   ├── slot1.json
│   ├── slot1.json.bak
│   ├── slot2.json
│   └── ...
└── _meta/
    ├── version.txt                # 현재 스키마 버전
    └── crash_recovery/            # 비정상 종료 시 임시 저장
```

### 스키마 버전 + 마이그레이션

모든 세이브 파일 최상단에 `schemaVersion`:
```json
{ "schemaVersion": 3, "...": "..." }
```

로드 시:
```typescript
function load<T>(path: string, schema: ZodType<T>, migrations: Migration[]): T {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  let current = raw;
  while (current.schemaVersion < CURRENT_VERSION) {
    const migration = migrations.find(m => m.from === current.schemaVersion);
    if (!migration) throw `No migration from v${current.schemaVersion}`;
    current = migration.up(current);
  }
  return schema.parse(current); // Zod 최종 검증
}
```

마이그레이션 등록:
```typescript
const migrations: Migration[] = [
  {
    from: 1, to: 2,
    up: (s) => ({ ...s, schemaVersion: 2, statistics: { ...s.statistics, totalCardsModified: 0 } }),
  },
  {
    from: 2, to: 3,
    up: (s) => ({ ...s, schemaVersion: 3, passiveSkills: s.passiveSkills ?? [] }),
  },
];
```

### 원자적 쓰기 (Atomic Write)

쓰는 중 크래시 → 파일 손상 방지:

```typescript
function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.fsyncSync(fs.openSync(tmp, 'r+'));
  // 기존 파일을 .bak 으로 백업
  if (fs.existsSync(path)) fs.renameSync(path, `${path}.bak`);
  fs.renameSync(tmp, path);
}
```

손상 감지 시 `.bak` 자동 복원:
```typescript
function loadResilient(path: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    const bakPath = `${path}.bak`;
    if (fs.existsSync(bakPath)) {
      console.warn(`Save corrupted, restoring from backup: ${path}`);
      fs.copyFileSync(bakPath, path);
      return JSON.parse(fs.readFileSync(path, 'utf8'));
    }
    throw e;
  }
}
```

### 저장 트리거

세이브는 다음 시점에 자동:
- 휴식처 진입 시
- 시작 페이즈 진입 시
- 노드 이동 후 (이벤트/전투 시작 직전)
- 전투 종료 후
- 사망 시 (슬롯 wipe 직전)
- 종료 시
- 사용자 명시 액션 (`타이틀로 돌아가기`)

전투 중간 매 턴 저장은 X (성능). 전투 중 강제 종료 시 손해 — 디자인 트레이드오프.

### Zod 스키마

```typescript
import { z } from 'zod';

const CardInstanceSchema = z.object({
  instanceId: z.string().uuid(),
  defId: z.string(),
  modifiers: z.array(z.object({
    id: z.string(),
    appliedAt: z.number(),
    source: z.object({ kind: z.string(), contextId: z.string().optional(), runId: z.string().optional() }),
  })),
  acquired: z.object({ kind: z.string(), contextId: z.string().optional(), runId: z.string().optional() }),
});

const InventoryStateSchema = z.object({
  capacity: z.number().int().nonnegative(),
  cards: z.array(CardInstanceSchema),
});

const GlobalStateSchema = z.object({
  schemaVersion: z.number(),
  gold: z.number().int().nonnegative(),
  inventory: InventoryStateSchema,
  passiveSkills: z.array(z.string()),
  difficultyMaxReached: z.number().int().nonnegative(),
  statistics: z.object({ /* ... */ }),
  eventsCleared: z.array(z.string()),  // Set은 array로 직렬화
});

// 슬롯 스키마는 SlotState discriminated union
const SlotStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('atRest') }),
  z.object({ kind: z.literal('inStartPhase'), pendingSkillChoice: z.any().optional() }),
  z.object({ kind: z.literal('inRun'), run: RunStateSchema }),
]);
```

세이브 무결성: ID 참조 (예: `CardInstance.defId`) 가 현재 콘텐츠에 없으면? → 게임 업데이트로 카드가 사라진 경우. 처리 옵션:
- **엄격**: 로드 실패
- **관대 (권장)**: 알 수 없는 카드는 자동 폐기 + 알림 ("일부 카드가 새 버전에서 제거되었습니다. {N}장이 골드로 환산되었습니다.")

## 2. 콘텐츠 데이터 파이프라인

### 작성 → 변환 → 런타임

```
authoring/                    [작성용, 사람이 만짐]
├── cards.xlsx                 (Excel 시트)
├── enemies.xlsx
├── relics.xlsx
├── modifiers.xlsx
├── statuses.xlsx
├── card_pools.xlsx
├── modifier_pools.xlsx
├── skill_boxes.yaml
├── difficulty/
│   └── difficulty_table.yaml
├── events/                   (이벤트는 계층 구조라 YAML)
│   ├── journey_start.yaml
│   ├── shop_default.yaml
│   └── scenarios/
│       └── scenario_12.yaml
└── economy/
    ├── sell_prices.yaml
    └── inventory_upgrades.yaml

         │  npm run build:data
         ▼

src/data/generated/           [런타임, 자동 생성, 커밋 OK]
├── index.ts                   (re-export)
├── cards.json
├── enemies.json
├── relics.json
├── modifiers.json
├── statuses.json
├── card_pools.json
├── modifier_pools.json
├── skill_boxes.json
├── difficulty.json
├── events.json
├── flows.json
├── economy.json
└── _validation_report.json    (빌드 통계 + 경고)
```

### `scripts/build-data.ts` 동작

```typescript
async function buildData() {
  // 1. authoring/ 의 모든 소스 읽기
  const xlsxFiles = glob('authoring/**/*.xlsx');
  const yamlFiles = glob('authoring/**/*.yaml');

  // 2. 각 파일 → 도메인 객체 변환
  const cards     = parseXlsxAs(CardSheetSchema,     'authoring/cards.xlsx');
  const enemies   = parseXlsxAs(EnemySheetSchema,    'authoring/enemies.xlsx');
  const modifiers = parseXlsxAs(ModifierSheetSchema, 'authoring/modifiers.xlsx');
  // ...
  const events    = await Promise.all(
    glob('authoring/events/**/*.yaml').map(p => parseYamlAs(EventDefSchema, p))
  );

  // 3. 교차 참조 검증
  validate({
    cards, enemies, modifiers, pools, events, flows, /* ... */
  });
  // 검증: 모든 modifierPoolRefs의 ID 존재, 모든 풀 entry의 modifierId 존재 등

  // 4. JSON 출력
  fs.writeFileSync('src/data/generated/cards.json',     JSON.stringify(cards, null, 2));
  fs.writeFileSync('src/data/generated/enemies.json',   JSON.stringify(enemies, null, 2));
  // ...

  // 5. index.ts 생성
  fs.writeFileSync('src/data/generated/index.ts', generateIndexTs());

  // 6. 리포트
  console.log(`Built: ${cards.length} cards, ${enemies.length} enemies, ${events.length} events.`);
  fs.writeFileSync('src/data/generated/_validation_report.json',
    JSON.stringify({ ts: Date.now(), counts: {...}, warnings: [...] }, null, 2));
}
```

### Excel 시트 스키마

각 xlsx의 첫 행은 헤더, 1행 = 1 엔티티.

#### `cards.xlsx` (예시)

| id | name | cost | type | target | rarity | tags | keywords | baseDescription | baseEffects | modifierPoolRefs | maxModifiers |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dagger_throw | 단검투척 | 1 | attack | enemy | common | physical,dagger,single | | 적에게 {damage}의 피해 | `[{kind:"damage",amount:10,target:"enemy"}]` | pool_attack_generic,pool_single_target,pool_dagger | |
| heal_light | 회복의 빛 | 1 | skill | self | uncommon | holy | | hp 5 회복 | `[{kind:"gainHp",amount:5}]` | pool_holy_skill,pool_self_skill | |

복잡한 필드 (`baseEffects`, 배열, 객체)는 JSON 문자열로 입력. 파서가 `JSON.parse(cell)` 처리.

배열 필드 (`tags`, `keywords`, `modifierPoolRefs`)는 콤마 구분.

> 디자이너 친화 팁: `baseEffects` 같은 JSON 셀이 부담이면 **별도 시트** `effects.xlsx` 에서 effect를 별도 ID로 정의하고, cards.xlsx 에서는 ID 참조만 — v2 검토.

#### `modifiers.xlsx`

| id | name | weight | tags | conflictsWith | requires | transforms | descriptionTemplate | customHandlerId |
|---|---|---|---|---|---|---|---|---|
| mod_damage_plus_5 | 예리함 | 10 | physical | | | `[{op:"modifyEffect",match:{kind:"damage"},set:{amount:{delta:5}}}]` | 피해량이 5 증가합니다. | |
| mod_target_to_all | 확산 | 3 | | | | `[{op:"modifyEffect",match:{target:"enemy"},set:{target:"allEnemies"}}]` | 단일 적 → 모든 적 | |

#### `modifier_pools.xlsx`

각 풀의 엔트리는 다중 행:

| poolId | poolName | modifierId | weight | conditional |
|---|---|---|---|---|
| pool_attack_generic | 일반 공격 강화 | mod_damage_plus_5 | 10 | |
| pool_attack_generic | 일반 공격 강화 | mod_damage_plus_8 | 5 | |
| pool_dagger | 단검 강화 | mod_bleed_on_hit | 5 | |
| pool_dagger | 단검 강화 | mod_pierce_armor | 3 | |

파서가 `poolId` 로 그룹핑.

### YAML 형식 (이벤트/플로우)

이벤트는 계층이라 YAML이 자연스럽다. 04 문서의 `journey_start.yaml` 예시 참조.

각 이벤트 YAML 파일은 `event:` + `flow:` 두 키를 둘 다 또는 하나만 가짐:
- 둘 다: 새 이벤트 + 새 Flow
- `event:` 만: 기존 Flow를 참조 (`event.flowId` 명시)
- `flow:` 만: 재사용 시나리오 (`scenarios/` 폴더 권장)

### 교차 참조 검증 (build 실패 조건)

```typescript
function validate(data: AllData): void {
  const errs: string[] = [];
  const cardIds      = new Set(data.cards.map(c => c.id));
  const modIds       = new Set(data.modifiers.map(m => m.id));
  const modPoolIds   = new Set(data.modifierPools.map(p => p.id));
  const cardPoolIds  = new Set(data.cardPools.map(p => p.id));
  const eventIds     = new Set(data.events.map(e => e.event.id));
  const flowIds      = new Set([...data.flows, ...data.events.flatMap(e => e.flow ? [e.flow] : [])].map(f => f.id));
  const skillIds     = new Set(data.skills.map(s => s.id));
  const enemyGroupIds= new Set(data.enemyGroups.map(g => g.id));

  // 카드 → 모디파이어 풀 참조
  for (const c of data.cards) {
    for (const ref of c.modifierPoolRefs) {
      if (!modPoolIds.has(ref)) errs.push(`card '${c.id}' refs unknown modifier pool '${ref}'`);
    }
  }
  // 모디파이어 풀 → 모디파이어 ID 참조
  for (const p of data.modifierPools) {
    for (const e of p.entries) {
      if (!modIds.has(e.modifierId)) errs.push(`pool '${p.id}' refs unknown modifier '${e.modifierId}'`);
    }
  }
  // 카드 풀 → 카드 ID 참조
  for (const p of data.cardPools) {
    for (const e of p.entries) {
      if (!cardIds.has(e.cardDefId)) errs.push(`card pool '${p.id}' refs unknown card '${e.cardDefId}'`);
    }
  }
  // 이벤트 → 플로우 참조
  for (const ev of data.events) {
    if (!flowIds.has(ev.event.flowId)) errs.push(`event '${ev.event.id}' refs unknown flow '${ev.event.flowId}'`);
  }
  // 플로우 step 그래프: entryStepId 존재, 모든 next/goto/branch.next 존재
  for (const fl of data.flows) {
    if (!fl.steps[fl.entryStepId]) errs.push(`flow '${fl.id}' entryStep '${fl.entryStepId}' missing`);
    for (const [sid, step] of Object.entries(fl.steps)) {
      const targets = collectStepTargets(step);
      for (const t of targets) {
        if (!fl.steps[t]) errs.push(`flow '${fl.id}' step '${sid}' refs unknown step '${t}'`);
      }
    }
  }
  // CombatStartStep → 적 그룹
  // SkillOfferStep → 스킬 풀
  // ApplyEffect → Effect kind 유효
  // ...

  if (errs.length > 0) {
    console.error('=== Data validation failed ===');
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
}
```

ID는 영문 소문자 + 숫자 + 언더스코어. 정규식 검증.

### CI에서의 동작

`npm test` 가 자동으로 `npm run build:data` 를 선행. 데이터가 깨지면 PR이 머지 불가.

### 로컬 개발 워크플로우

```
1. authoring/cards.xlsx 수정
2. npm run build:data
3. npm run dev   (변경 즉시 반영)
```

또는 watch 모드:
```
npm run build:data -- --watch
```

### Excel 대신 Google Sheets

옵션. 동일한 시트 스키마를 Google Sheets에 두고 CSV export → `authoring/cards.csv`. 파서가 xlsx/csv 모두 처리하도록 (다중 어댑터).

장점: 협업 + 히스토리.
단점: 추가 의존성 (gspread 등) 또는 수동 export.

v1 은 xlsx 직접 처리. csv 어댑터는 추후 옵션.

## 3. 데이터 핫리로드 (개발 모드)

```typescript
if (process.env.NODE_ENV === 'development') {
  chokidar.watch('src/data/generated/').on('change', () => {
    registry.reload();
    notifyUI('Data reloaded.');
  });
}
```

런타임에 카드 정의가 바뀌어도 기존 CardInstance는 살아있음 (defId 만 참조). 단, 정의에서 변수 치환·렌더링은 최신 정의로.

## 4. 런타임 레지스트리

```typescript
class Registry {
  cards         = new Map<CardDefId, CardDefinition>();
  modifiers     = new Map<ModifierId, Modifier>();
  modifierPools = new Map<ModifierPoolId, ModifierPool>();
  cardPools     = new Map<string, CardPool>();
  statuses      = new Map<StatusId, StatusDefinition>();
  enemies       = new Map<EnemyId, EnemyDefinition>();
  enemyGroups   = new Map<string, EnemyGroupDefinition>();
  skills        = new Map<SkillId, SkillDefinition>();
  events        = new Map<EventId, EventDefinition>();
  flows         = new Map<ScenarioId, FlowDefinition>();
  skillBoxes    = new Map<SkillGrade, SkillBoxDefinition>();
  difficulty    = new Map<number, DifficultyEntry>();

  load(generated: GeneratedData): void {
    // 모든 맵을 채움
  }

  reload(): void {
    // generated/ 다시 읽고 재구성
  }
}
```

엔진은 레지스트리를 dependency-injected 받음 → 테스트 시 mock 레지스트리.

## 미정 (TBD)

- **세이브 압축**: gzip? 일단 plaintext (디버그 용이).
- **세이브 암호화**: 치팅 방지 — 싱글 게임이라 우선순위 낮음.
- **수동 백업/익스포트 UI**: v1 외.
- **데이터 i18n**: 카드 이름·설명을 언어별로 분리할지 — v1 한국어 only, 필드 구조만 미래 대비.
