# 01. 엔진 프리미티브 (Type Reference)

게임의 모든 명사를 TypeScript 의사 코드로 정의한다. 이 문서가 모든 후속 문서의 어휘 사전이다.

> 표기: `?` 는 optional, `readonly` 는 불변, `Id` 접미 타입은 모두 `string` newtype.

## 0. ID 타입 (분류용 newtype)

```typescript
type CardDefId      = string;  // 'dagger_throw'
type CardInstanceId = string;  // UUID v4
type ModifierId     = string;  // 'mod_damage_plus_5'
type ModifierPoolId = string;  // 'pool_dagger_skill'
type StatusId       = string;  // 'bleed'
type EnemyId        = string;  // 'slaver_blue'
type SkillId        = string;  // 'skill_lifesteal'
type EventId        = string;  // 'journey_start'
type ScenarioId     = string;  // 'scenario_12'
type NodeTypeId     = string;  // 'combat_normal' | 'combat_elite' | ...
type RelicId        = string;  // (확장 여지)
type EffectTag      = string;  // 'fire' | 'physical' | 'dagger' | 'aoe' (확장 가능 태그)
```

## 1. Card

### CardDefinition (불변, 데이터)

```typescript
interface CardDefinition {
  readonly id: CardDefId;
  readonly name: string;
  readonly cost: Cost;                   // 에너지 비용 (또는 X cost 등)
  readonly type: CardType;               // attack | skill | power | curse | status
  readonly target: TargetSpec;           // 타겟팅 규칙
  readonly rarity: Rarity;               // common | uncommon | rare | special
  readonly tags: ReadonlyArray<EffectTag>;
  readonly keywords: ReadonlyArray<CardKeyword>; // exhaust | retain | ethereal | innate | unplayable
  readonly baseDescription: string;      // 템플릿. {damage} 등 변수 치환
  readonly baseEffects: ReadonlyArray<Effect>;
  readonly modifierPoolRefs: ReadonlyArray<ModifierPoolId>; // 강화 시 어떤 풀에서 뽑을지
  readonly maxModifiers?: number;        // 슬롯 한도 (없으면 무제한)
}

type CardType    = 'attack' | 'skill' | 'power' | 'curse' | 'status';
type Cost        = { kind: 'fixed'; value: number } | { kind: 'x' } | { kind: 'unplayable' };
type Rarity      = 'starter' | 'common' | 'uncommon' | 'rare' | 'special';
type CardKeyword = 'exhaust' | 'retain' | 'ethereal' | 'innate' | 'unplayable';

type TargetSpec =
  | { kind: 'none' }
  | { kind: 'self' }
  | { kind: 'enemy' }
  | { kind: 'allEnemies' }
  | { kind: 'randomEnemy' }
  | { kind: 'ally' }            // 향후 동료 시스템 대비 placeholder
  | { kind: 'choice'; from: 'hand' | 'discard' | 'draw' | 'exhaust' };
```

### CardInstance (가변, 세이브 데이터)

```typescript
interface CardInstance {
  readonly instanceId: CardInstanceId;   // UUID. 영구 고유.
  readonly defId: CardDefId;             // 어떤 정의를 참조하는지
  modifiers: ModifierInstance[];          // 부착된 강화 (순서 의미 있음 — 적용 순서)
  acquired: AcquisitionMeta;              // 어디서 얻었는지 (디버그/로어)
}

interface ModifierInstance {
  readonly id: ModifierId;
  readonly appliedAt: number;            // epoch ms (디버그용)
  readonly source: AcquisitionMeta;
}

interface AcquisitionMeta {
  readonly kind: 'starter' | 'event' | 'shop' | 'reward' | 'warehouse';
  readonly contextId?: string;           // 이벤트 id 등
  readonly runId?: string;
}
```

## 2. Modifier

### Modifier (불변, 데이터)

```typescript
interface Modifier {
  readonly id: ModifierId;
  readonly name: string;
  readonly descriptionTemplate: string;  // "피해량이 {amount} 증가합니다." 같은 템플릿
  readonly tags: ReadonlyArray<EffectTag>;
  readonly weight: number;               // 풀 내 기본 가중치 (풀이 override 가능)
  readonly conflictsWith?: ReadonlyArray<ModifierId>; // 같이 못 붙는 모디파이어
  readonly requires?: ReadonlyArray<ModifierId>;      // 선행 모디파이어
  readonly transforms: ReadonlyArray<EffectTransform>;
}
```

### EffectTransform (효과 파이프라인 변형 DSL)

```typescript
type EffectTransform =
  | { op: 'modifyEffect'; match: EffectMatcher; set: EffectPatch }
  | { op: 'appendEffect'; effect: Effect }
  | { op: 'prependEffect'; effect: Effect }
  | { op: 'replaceEffect'; match: EffectMatcher; with: Effect }
  | { op: 'removeEffect'; match: EffectMatcher }
  | { op: 'wrapEffect'; match: EffectMatcher; before?: Effect; after?: Effect }
  | { op: 'modifyCost'; delta: number }
  | { op: 'addKeyword'; keyword: CardKeyword }
  | { op: 'removeKeyword'; keyword: CardKeyword };

interface EffectMatcher {
  kind?: Effect['kind'];                 // 효과 종류 필터
  target?: TargetSpec['kind'];           // 타겟 종류 필터
  tags?: ReadonlyArray<EffectTag>;
  index?: number | 'first' | 'last' | 'all'; // 기본 'all'
}

type EffectPatch = {
  amount?: number | { delta: number } | { mul: number };
  target?: TargetSpec['kind'];
  // 효과 종류별로 patch 가능 필드는 별도 정의 (02 문서 참조)
};
```

### ModifierPool (불변, 데이터)

```typescript
interface ModifierPool {
  readonly id: ModifierPoolId;
  readonly name: string;
  readonly entries: ReadonlyArray<ModifierPoolEntry>;
}

interface ModifierPoolEntry {
  readonly modifierId: ModifierId;
  readonly weight: number;               // 이 풀에서의 가중치 (Modifier.weight override)
  readonly conditional?: PoolCondition;  // 조건부 포함
}

type PoolCondition =
  | { kind: 'hasTag'; tag: EffectTag }
  | { kind: 'minLevel'; level: number }
  | { kind: 'custom'; predicateId: string }; // 코드 핸들러 참조
```

## 3. Effect (원자 단위)

```typescript
type Effect =
  // 데미지/방어
  | { kind: 'damage'; amount: number; target: TargetSpec['kind']; tags?: EffectTag[] }
  | { kind: 'damageMultiHit'; amount: number; hits: number; target: TargetSpec['kind'] }
  | { kind: 'gainBlock'; amount: number; target?: 'self' | 'ally' }
  // 상태 효과
  | { kind: 'applyStatus'; status: StatusId; stacks: number; target: TargetSpec['kind'] }
  | { kind: 'removeStatus'; status: StatusId; target: TargetSpec['kind'] }
  // 자원
  | { kind: 'gainEnergy'; amount: number }
  | { kind: 'loseEnergy'; amount: number }
  | { kind: 'gainGold'; amount: number }
  | { kind: 'gainHp'; amount: number }
  | { kind: 'loseHp'; amount: number; ignoreBlock?: boolean }
  // 카드 조작
  | { kind: 'draw'; count: number }
  | { kind: 'discardRandom'; count: number }
  | { kind: 'discardChoose'; count: number }
  | { kind: 'exhaustChoose'; count: number; from: 'hand' | 'discard' | 'draw' }
  | { kind: 'addCardToPile'; cardDefId: CardDefId; pile: PileLocation; copies?: number }
  | { kind: 'upgradeCardInDeck'; choose: boolean; tag?: EffectTag } // 던전 내 강화
  // 메타 조작 (이벤트에서만)
  | { kind: 'gainCardToInventory'; cardDefId: CardDefId; modifierIds?: ModifierId[] }
  | { kind: 'gainSkill'; skillId: SkillId }
  | { kind: 'gainGoldMeta'; amount: number }   // 글로벌 골드
  // 커스텀 (코드 핸들러)
  | { kind: 'custom'; handlerId: string; params?: Record<string, unknown> };

type PileLocation = 'hand' | 'draw' | 'discard' | 'exhaust';
```

`Effect.amount` 등 수치는 모디파이어 적용 후 최종 값. 모디파이어가 base를 변형해 만든 결과가 `Effect` 인스턴스다.

## 4. Status

```typescript
interface StatusDefinition {
  readonly id: StatusId;
  readonly name: string;
  readonly description: string;
  readonly stackingRule: StackingRule;
  readonly tickTiming: TickTiming;
  readonly decay: DecayRule;
  readonly tags: ReadonlyArray<EffectTag>;
  readonly hooks: ReadonlyArray<StatusHook>;  // 어느 이벤트에 반응할지
}

type StackingRule = 'sum' | 'max' | 'duration';
// sum: 같은 상태 다시 걸리면 stacks 합산 (예: 출혈)
// max: 더 높은 값만 (예: 어떤 보호막)
// duration: 별도 duration 추적 (예: 약화 N턴)

type TickTiming =
  | 'startOfOwnerTurn'
  | 'endOfOwnerTurn'
  | 'onDamageTaken'
  | 'onDamageDealt'
  | 'onCardPlayed'
  | 'manual';                            // 효과가 명시적으로 발동

type DecayRule =
  | { kind: 'none' }                     // 영구 (근력 등)
  | { kind: 'fixedPerTurn'; amount: number }   // 턴마다 N 감소
  | { kind: 'allAtEndOfTurn' }           // 턴 끝에 전부 사라짐 (방어도)
  | { kind: 'oneStackPerTrigger' };      // 트리거당 1 감소

interface StatusHook {
  readonly on: StatusEventName;
  readonly effects: ReadonlyArray<Effect>;
  readonly condition?: ConditionExpr;    // 조건부 발동
}

type StatusEventName =
  | 'onTakeDamage'
  | 'onDealDamage'
  | 'onTurnStart'
  | 'onTurnEnd'
  | 'onCardPlayed'
  | 'onApplied'
  | 'onRemoved';

interface StatusInstance {
  readonly id: StatusId;
  stacks: number;
  duration?: number;                     // duration 모드일 때만
}
```

## 5. Enemy

```typescript
interface EnemyDefinition {
  readonly id: EnemyId;
  readonly name: string;
  readonly tier: EnemyTier;
  readonly hpRange: [number, number];
  readonly intentScript: IntentScript;
  readonly initialStatuses?: ReadonlyArray<{ id: StatusId; stacks: number }>;
  readonly tags: ReadonlyArray<EffectTag>;
  readonly rewards: EnemyRewards;
}

type EnemyTier = 'normal' | 'elite' | 'boss' | 'finalBoss';

interface IntentScript {
  // 단순 사이클 또는 가중치 기반 의도 결정
  readonly mode: 'cycle' | 'weighted' | 'scripted';
  readonly intents: ReadonlyArray<Intent>;
}

interface Intent {
  readonly id: string;
  readonly display: IntentDisplay;         // 의도 아이콘 + 숫자
  readonly effects: ReadonlyArray<Effect>;
  readonly weight?: number;
  readonly conditions?: ReadonlyArray<ConditionExpr>;
  readonly nextIntentId?: string;          // scripted 모드일 때
}

interface IntentDisplay {
  readonly kind: 'attack' | 'defend' | 'buff' | 'debuff' | 'unknown';
  readonly value?: number;                 // 표시 숫자 (예: 공격 12)
  readonly hits?: number;                  // 멀티힛 표시
}

interface EnemyRewards {
  readonly goldRange: [number, number];
  readonly cardRewardPool?: ModifierPoolId | string; // 카드 풀 (별도 정의 가능)
  readonly cardRewardCount?: number;
  readonly skillDropChance?: number;       // 0.0~1.0
}

interface EnemyInstance {
  readonly defId: EnemyId;
  readonly instanceId: string;
  hp: number;
  maxHp: number;
  block: number;
  statuses: StatusInstance[];
  intentCursor: number;                    // 사이클 모드 인덱스
  nextIntent: Intent;
}
```

## 6. Skill (캐릭터 귀속 패시브) & PassiveSkill (영구)

```typescript
interface SkillDefinition {
  readonly id: SkillId;
  readonly name: string;
  readonly description: string;
  readonly grade: SkillGrade;              // 박스 등급과 매칭
  readonly tags: ReadonlyArray<EffectTag>;
  readonly hooks: ReadonlyArray<SkillHook>;
  readonly passiveEligible: boolean;       // 최종보스 보상으로 패시브화 가능 여부
}

type SkillGrade = 'lowest' | 'low' | 'mid' | 'high' | 'highest';

interface SkillHook {
  readonly on: GameEventName;              // 'onCombatStart' | 'onCardPlayed' | ...
  readonly effects: ReadonlyArray<Effect>;
  readonly condition?: ConditionExpr;
}

type GameEventName =
  | 'onCombatStart' | 'onCombatEnd'
  | 'onTurnStart' | 'onTurnEnd'
  | 'onCardPlayed' | 'onCardDrawn' | 'onCardDiscarded' | 'onCardExhausted'
  | 'onDamageDealtByPlayer' | 'onDamageTakenByPlayer'
  | 'onEnemyKilled'
  | 'onNodeEntered' | 'onNodeCleared'
  | 'onRunStart' | 'onRunEnd';

interface SkillInstance {
  readonly id: SkillId;
  readonly acquired: AcquisitionMeta;
  // 일부 스킬은 카운터/스택을 유지할 수 있음
  state?: Record<string, number>;
}
```

`PassiveSkill` 은 `Global.passiveSkills: SkillId[]` 로만 표현. 발동 로직은 동일한 `SkillDefinition.hooks` 를 사용.

## 7. EventNode, Flow, FlowStep

```typescript
interface EventDefinition {
  readonly id: EventId;
  readonly name: string;
  readonly nodeType: NodeTypeId;           // 'event_normal' | 'event_trigger' | ...
  readonly flowId: ScenarioId;             // 어느 Flow 를 실행할지
  readonly availability?: AvailabilityRule;
  readonly oneShot?: boolean;              // true 면 글로벌로 1회만 등장
}

interface AvailabilityRule {
  readonly minDifficulty?: number;
  readonly maxDifficulty?: number;
  readonly requiresEventCleared?: ReadonlyArray<EventId>;
  readonly forbidsEventCleared?: ReadonlyArray<EventId>;
  readonly customPredicateId?: string;
}

interface FlowDefinition {
  readonly id: ScenarioId;
  readonly entryStepId: string;
  readonly steps: Record<string, FlowStep>;
}

type FlowStep =
  | DialogueStep | ChoiceStep | CardOfferStep
  | SkillOfferStep | CardUpgradeStep | CardModifierAttachStep
  | ApplyEffectStep | BranchStep | CombatStartStep
  | GotoStep | EndStep;

interface DialogueStep {
  readonly kind: 'dialogue';
  readonly speaker?: string;
  readonly text: string;                   // 변수 치환 지원: {playerName}, {gold} 등
  readonly next: string;                   // 다음 step id
}

interface ChoiceStep {
  readonly kind: 'choice';
  readonly prompt?: string;
  readonly options: ReadonlyArray<ChoiceOption>;
}

interface ChoiceOption {
  readonly label: string;
  readonly disabledLabel?: string;         // 비활성화 시 표시 텍스트
  readonly condition?: ConditionExpr;      // 미충족 시 비활성 (회색 표시)
  readonly hidden?: ConditionExpr;         // 미충족 시 아예 숨김
  readonly effects?: ReadonlyArray<Effect>;
  readonly probabilistic?: ProbabilisticBranch;  // 성공/실패 분기
  readonly next?: string;                  // 다음 step id (probabilistic이 있으면 무시)
}

interface ProbabilisticBranch {
  readonly chance: number;                 // 0.0~1.0
  readonly successNext: string;
  readonly failureNext: string;
  readonly chanceModifierExpr?: string;    // 보유 유물/스킬에 따른 보정
}

interface CardOfferStep {
  readonly kind: 'cardOffer';
  readonly poolId: string;                 // 카드 풀 ID (별도 시스템)
  readonly picksPerIteration: number;      // 한 번에 N개 중 선택
  readonly iterations: number;             // 몇 번 반복
  readonly destination: 'inventory' | 'currentDeck';
  readonly allowSkip?: boolean;
  readonly next: string;
}

interface SkillOfferStep {
  readonly kind: 'skillOffer';
  readonly grade?: SkillGrade;             // 명시 시 해당 등급에서만
  readonly poolOverride?: ReadonlyArray<SkillId>;
  readonly count: number;
  readonly allowSkip?: boolean;
  readonly next: string;
}

interface CardUpgradeStep {
  readonly kind: 'cardUpgrade';
  readonly source: 'currentDeck' | 'inventory';
  readonly cardFilter?: CardFilter;        // 특정 태그만 가능 등
  readonly modifierPoolOverride?: {
    add?: ReadonlyArray<ModifierPoolId>;
    remove?: ReadonlyArray<ModifierPoolId>;
  };
  readonly forceModifierId?: ModifierId;   // 강제 부착 (이벤트 특수)
  readonly count: number;                  // 몇 장 강화할지
  readonly allowSkip?: boolean;
  readonly next: string;
}

interface CardModifierAttachStep {
  readonly kind: 'cardModifierAttach';
  readonly cardInstanceSelector: 'choose' | 'allInDeck' | 'allWithTag';
  readonly tag?: EffectTag;
  readonly modifierId: ModifierId;
  readonly next: string;
}

interface ApplyEffectStep {
  readonly kind: 'applyEffect';
  readonly effects: ReadonlyArray<Effect>;
  readonly next: string;
}

interface BranchStep {
  readonly kind: 'branch';
  readonly branches: ReadonlyArray<{
    readonly condition: ConditionExpr;
    readonly next: string;
  }>;
  readonly defaultNext: string;
}

interface CombatStartStep {
  readonly kind: 'combatStart';
  readonly enemyGroupId: string;           // 인카운터 그룹 ID
  readonly afterVictoryNext: string;
  readonly afterDefeatNext?: string;       // 미지정 시 사망 처리
  readonly rewardOverrides?: Partial<EnemyRewards>;
}

interface GotoStep {
  readonly kind: 'goto';
  readonly stepId: string;
}

interface EndStep {
  readonly kind: 'end';
  readonly outcome?: 'success' | 'failure' | 'neutral';
}

interface CardFilter {
  readonly tags?: ReadonlyArray<EffectTag>;
  readonly types?: ReadonlyArray<CardType>;
  readonly minRarity?: Rarity;
  readonly maxRarity?: Rarity;
}
```

## 8. ConditionExpr (조건식)

```typescript
type ConditionExpr =
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'and'; of: ReadonlyArray<ConditionExpr> }
  | { kind: 'or';  of: ReadonlyArray<ConditionExpr> }
  | { kind: 'not'; of: ConditionExpr }
  | { kind: 'hasGold'; min?: number; max?: number }
  | { kind: 'hasGoldMeta'; min?: number }  // 글로벌 골드
  | { kind: 'hasCardInDeck'; defId?: CardDefId; tag?: EffectTag; min?: number }
  | { kind: 'hasCardInInventory'; defId?: CardDefId; tag?: EffectTag; min?: number }
  | { kind: 'hasSkill'; skillId: SkillId }
  | { kind: 'hasPassive'; skillId: SkillId }
  | { kind: 'hpPercent'; min?: number; max?: number }
  | { kind: 'difficultyAtLeast'; level: number }
  | { kind: 'eventCleared'; eventId: EventId }
  | { kind: 'eventNotCleared'; eventId: EventId }
  | { kind: 'random'; chance: number }     // 평가 시 1회 주사위
  | { kind: 'custom'; predicateId: string; params?: Record<string, unknown> };
```

`ConditionEvaluator` 가 통일된 평가기. UI에서는 `label` + `condition` 만 받아서 비활성 여부 판단.

## 9. Map, MapNode

```typescript
interface MapState {
  readonly width: number;                  // 그리드 가로
  readonly height: number;                 // 그리드 세로
  readonly nodes: Record<string, MapNode>; // key = `${x},${y}`
  readonly edges: Record<string, EdgeState>; // key = edge id (정렬된 두 노드)
  currentNodeKey: string;
  visitedNodeKeys: Set<string>;            // 이벤트 발동 여부
  rngSeed: string;                         // 결정적 생성용
}

interface MapNode {
  readonly key: string;                    // `${x},${y}`
  readonly x: number;
  readonly y: number;
  readonly nodeType: NodeTypeId;
  readonly eventId?: EventId;              // 이벤트 노드일 때
  readonly enemyGroupId?: string;          // 전투 노드일 때
  readonly meta?: Record<string, unknown>;
}

interface EdgeState {
  readonly id: string;                     // 정렬된 두 key의 join
  readonly nodeAKey: string;
  readonly nodeBKey: string;
  consumed: boolean;
  revived?: boolean;                       // 막힘 해소로 부활한 엣지
}

type NodeTypeId =
  | 'combat_normal' | 'combat_elite' | 'combat_boss'
  | 'event_normal'  | 'event_trigger'
  | 'shop' | 'rest'
  | 'treasure'
  | 'unknown';                             // 슬더스의 ? 노드처럼 진입 시 랜덤 결정
```

엣지 id 생성 규칙: 두 node key를 사전순 정렬 후 `|` 로 join. 예: `"2,3|2,4"`.

## 10. Player, Run, Combat, Slot, Global

```typescript
interface PlayerStateInRun {
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  block: number;
  gold: number;                            // 현재 런의 임시 골드 (휴식처 복귀 시 글로벌로 환원)
  statuses: StatusInstance[];
  hand: CardInstance[];
  drawPile: CardInstance[];
  discardPile: CardInstance[];
  exhaustPile: CardInstance[];
  deckIds: CardInstanceId[];               // 시작 덱의 스냅샷 (재시작용)
  drawAmountPerTurn: number;
  skillIds: SkillId[];                     // 현재 캐릭터 보유 스킬
}

interface RunState {
  readonly runId: string;
  readonly characterName: string;
  readonly startedAt: number;
  readonly difficultyLevel: number;        // 이번 런 입장 시점의 난이도
  player: PlayerStateInRun;
  map: MapState;
  currentNodeKey: string;
  currentEvent?: EventRuntimeState;        // 이벤트 진행 중일 때
  currentCombat?: CombatState;             // 전투 중일 때
  log: ReadonlyArray<LogEntry>;
}

interface CombatState {
  readonly combatId: string;
  enemies: EnemyInstance[];
  turn: number;
  phase: 'playerTurn' | 'enemyTurn' | 'resolving' | 'won' | 'lost';
  awaiting?: AwaitInput;                   // 타겟 선택 등 입력 대기
}

interface AwaitInput {
  readonly kind: 'pickEnemy' | 'pickCardInHand' | 'pickCardInPile';
  readonly forEffectIndex: number;
  readonly cardInstanceId?: CardInstanceId;
}

interface EventRuntimeState {
  readonly eventId: EventId;
  readonly flowId: ScenarioId;
  currentStepId: string;
  history: ReadonlyArray<string>;          // 거쳐온 step ids
  variables: Record<string, unknown>;      // 이벤트 내 임시 변수
}

interface Slot {
  readonly slotIndex: 0 | 1 | 2 | 3 | 4;
  characterName?: string;
  // 상태 분기:
  state: SlotState;
  difficultyLevel: number;                 // 이 캐릭터의 현재 난이도 카운터
  totalRunsCompleted: number;
  createdAt?: number;
  diedAt?: number;
}

type SlotState =
  | { kind: 'empty' }
  | { kind: 'atRest' }                     // 휴식처 메뉴
  | { kind: 'inRun'; run: RunState }
  | { kind: 'inStartPhase'; pendingSkillChoice?: SkillOfferContext };

interface SkillOfferContext {
  readonly affordableGrades: ReadonlyArray<SkillGrade>;
  readonly cheapestPrice: number;
  // 사용자가 어느 등급을 살지 선택
}

interface GlobalState {
  gold: number;                            // 모든 슬롯 공유
  inventory: InventoryState;
  passiveSkills: SkillId[];                // 최종보스 보상으로 영구
  difficultyMaxReached: number;
  statistics: GlobalStatistics;
  schemaVersion: number;
}

interface InventoryState {
  capacity: number;                        // 골드로 업그레이드
  cards: CardInstance[];
}

interface GlobalStatistics {
  totalRuns: number;
  totalDeaths: number;
  totalCardsAcquired: number;
  finalBossKills: number;
  hoursPlayed?: number;
}
```

## 11. Difficulty Table

```typescript
interface DifficultyEntry {
  readonly level: number;
  readonly enemyHpMultiplier: number;      // 1.0 base
  readonly enemyStrengthBonus: number;     // +N 근력
  readonly enemyDexterityBonus?: number;
  readonly specialBuffs?: ReadonlyArray<SpecialBuff>;
  readonly description?: string;           // 디자이너 메모
}

type SpecialBuff =
  | { kind: 'thorns'; amount: number }
  | { kind: 'firstHitInvuln' }
  | { kind: 'startWithBlock'; amount: number }
  | { kind: 'regenPerTurn'; amount: number }
  | { kind: 'extraIntent' }
  | { kind: 'custom'; handlerId: string };
```

`difficulty_table.csv` 행 1:1 매핑. 캐릭터의 `difficultyLevel` 로 인덱싱.

## 12. Action / Event-Bus

엔진은 reducer 패턴을 사용한다. UI/Service는 `Action` 을 디스패치하고, 엔진은 새 `EngineSnapshot` 을 리턴한다.

```typescript
type Action =
  // 메타
  | { type: 'SELECT_SLOT'; slotIndex: number }
  | { type: 'NEW_CHARACTER'; slotIndex: number; name: string }
  | { type: 'DELETE_SLOT'; slotIndex: number }
  // 휴식처
  | { type: 'REST_OPEN_INVENTORY' }
  | { type: 'REST_STORE_CARD'; cardInstanceId: CardInstanceId }
  | { type: 'REST_TAKE_FROM_INVENTORY'; cardInstanceId: CardInstanceId }
  | { type: 'REST_SELL_CARD'; cardInstanceId: CardInstanceId; from: 'deck' | 'inventory' }
  | { type: 'REST_BUY_INVENTORY_CAPACITY'; amount: number }
  | { type: 'REST_BEGIN_EXPLORATION' }
  // 시작 페이즈
  | { type: 'START_BUY_SKILLBOX'; grade: SkillGrade }
  | { type: 'START_SKIP_SKILLBOX' }
  | { type: 'START_FINALIZE_DECK' }
  // 맵
  | { type: 'MAP_MOVE_TO_NODE'; nodeKey: string }
  | { type: 'MAP_FORCE_DEADEND_RECOVERY' }  // 디버그/수동 트리거
  // 이벤트/플로우
  | { type: 'FLOW_ADVANCE' }                 // 대사 다음
  | { type: 'FLOW_CHOOSE'; optionIndex: number }
  | { type: 'FLOW_PICK_CARD'; cardDefId: CardDefId; iteration: number }
  | { type: 'FLOW_PICK_SKILL'; skillId: SkillId }
  | { type: 'FLOW_PICK_CARD_TO_UPGRADE'; cardInstanceId: CardInstanceId }
  | { type: 'FLOW_PICK_MODIFIER'; modifierId: ModifierId }
  // 전투
  | { type: 'COMBAT_PLAY_CARD'; cardInstanceId: CardInstanceId }
  | { type: 'COMBAT_TARGET'; enemyInstanceId: string }
  | { type: 'COMBAT_END_TURN' }
  | { type: 'COMBAT_CANCEL_TARGETING' }
  // 보스 보상
  | { type: 'PASSIVE_CHOOSE'; skillId: SkillId };

interface EngineSnapshot {
  readonly slots: ReadonlyArray<Slot>;
  readonly currentSlotIndex: number | null;
  readonly global: GlobalState;
  readonly view: ViewState;                // UI에 필요한 파생값
  readonly pendingActions?: ReadonlyArray<Action>; // 자동 진행되는 액션
}
```

## 13. 미정 / 향후 결정 (TBD)

- **RelicId** 가 별도 필요한지: 일단 `Skill` 로 통합 가능 (캐릭터 귀속). 진짜 슬더스식 "유물 = 영구"는 `PassiveSkill` 로 흡수.
- **카드 풀** (이벤트의 `CardOfferStep` 에서 쓰는 카드 ID 풀): `ModifierPool` 과 구조 동일. 별도 타입 `CardPool` 로 분리할지 통합할지 — 일단 분리 권장 (`CardPool { entries: { cardDefId, weight, conditional }[] }`).
- **`enemyGroupId`** 의 데이터 모델: 적 1+체 + 등장 위치 + 인트로 텍스트 정도. 별도 `EnemyGroupDefinition` 정의 필요.
- **이벤트 변수 시스템**: `EventRuntimeState.variables` 에 step에서 값을 set/get 하는 op가 필요할 수 있음. v1에선 read-only 컨텍스트만으로 시작.
