canvas = document.getElementById("game")
ctx = canvas.getContext("2d")
zoom = 1;
const BASE_ZOOM = 1.15;
const CAMERA_BREATH_ZOOM = 0.04;
const CAMERA_Y_FOLLOW_SPEED = 10;
const WORLD_SEED_STORAGE_KEY = 'miningEmpire.worldSeed.v1';
const SAVE_DATA_VERSION = 1;
const runeTintCanvas = document.createElement('canvas');
const runeTintCtx = runeTintCanvas.getContext('2d');

function normalizeSeedInput(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function createDefaultSeed() {
    return `WORLD-${Math.floor(Date.now() % 1000000)}`;
}

function getOrCreateWorldSeed() {
    let seed = '';
    try {
        seed = normalizeSeedInput(localStorage.getItem(WORLD_SEED_STORAGE_KEY));
    } catch (err) {
        seed = '';
    }

    if (!seed) {
        const suggested = createDefaultSeed();
        const entered = normalizeSeedInput(window.prompt('Choose a world seed:', suggested));
        seed = entered || suggested;
        try {
            localStorage.setItem(WORLD_SEED_STORAGE_KEY, seed);
        } catch (err) {
            // Ignore localStorage failures and continue with the in-memory seed.
        }
    }

    return seed;
}

function createSeededRandom(seedString) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedString.length; i++) {
        h ^= seedString.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return function nextRandom() {
        h += 0x6D2B79F5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hashSeedString(seedString) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedString.length; i++) {
        h ^= seedString.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
const WORLD_SEED = getOrCreateWorldSeed();
const WORLD_SEED_HASH = hashSeedString(WORLD_SEED);
const WORLD_SAVE_STORAGE_KEY = `miningEmpire.save.v${SAVE_DATA_VERSION}:${WORLD_SEED}`;
let extraOreCleared = new Set();

let bgX = 0;
let bgY = 0;

let cameraX = 0;
let cameraY = 0;
let cameraBaseY = 0;
let cameraBreathTime = 0;

frameWidth = 32;
frameHeight = 32;

ctx.imageSmoothingEnabled = false;
function animate(frameIndex, image, x, y, direction) {
    x = Math.round(x);
    y = Math.round(y);

    if (direction === 'Left') {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(
            image,
            frameWidth * frameIndex,
            0,
            frameWidth,
            frameHeight,
            -x - frameWidth,
            y,
            frameWidth * zoom,
            frameHeight * zoom
        );
        ctx.restore();
    } else {
        ctx.drawImage(
            image,
            frameWidth * frameIndex,
            0,
            frameWidth,
            frameHeight,
            x,
            y,
            frameWidth * zoom,
            frameHeight * zoom
        );
    }
}


function animateBackground(image, x, y = 0) {
    const w = canvas.width;
    const h = canvas.height;
    x = ((x % w) + w) % w;
    y = ((y % h) + h) % h;
    x -= w;
    y -= h;
    const dw = w;
    const dh = h;
    const dx = Math.round(x);
    const dy = Math.round(y);
    ctx.drawImage(image, dx, dy, dw, dh);
    ctx.drawImage(image, dx + dw, dy, dw, dh);
    ctx.drawImage(image, dx, dy + dh, dw, dh);
    ctx.drawImage(image, dx + dw, dy + dh, dw, dh);
    return x;
}

let lastTime = 0;
let autosaveTimer = 0;
let gameStateDirty = false;
let sprinting = false;
const frameDuration = 100;
const FALL_ANIMATION_FRAME_DURATION = 35;
const playerAnim = { name: 'idle', frameIndex: 0, timer: 0 };
const jumpDustAnim = { name: 'jumpDust', frameIndex: 0, timer: 0, playing: false };
const dustAnim = { name: 'dust', frameIndex: 0, timer: 0, playing: false };

let playerDirection = 'Right';
let playerX = 150;
let playerY = 0;
const speed = 120;
const climbSpeed = 90;
const keys = {};
let jumpConsumed = false;
let attackConsumed = false;
let dustX = 0;
let dustY = 0;
let lookDownOffset = 0;
let lookDownHoldTime = 0;
const playerInventory = {
    pickaxe: 1,
    backpack: {
        axe: 0,
        dirt: 0,
        grass: 0,
        stone: 0,
        wood: 0,
        bark: 0,
        woodPlanks: 0,
        willowSeed: 0,
        ladder: 0,
        pointer: 0,
        tripleJumpRune: 0,
        levitationRune: 0,
        laserRune: 0,
        diamond: 0,
        iron: 0,
        gold: 0
    },
    backpackCapacity: {
        axe: 1,
        dirt: 40,
        grass: 20,
        stone: 60,
        wood: 200,
        bark: 200,
        woodPlanks: 400,
        willowSeed: 25,
        ladder: 64,
        pointer: 64,
        tripleJumpRune: 3,
        levitationRune: 3,
        laserRune: 3,
        diamond: 8,
        iron: 20,
        gold: 12
    }
};
let equippedTool = 'Pickaxe';
const HOTBAR_SLOT_COUNT = 9;
const HOTBAR_SLOT_SIZE = 32;
const HOTBAR_SLOT_GAP = 4;
const HOTBAR_RESERVED_TOOL_SLOTS = [];
let hotbarSlots = ['pickaxe', 'hands', 'dirt', 'grass', null, null, null, null, null];
let selectedHotbarSlotIndex = 0;
let hotbarDrag = null;
let pickaxeSwingConsumed = false;
let pickaxeSwingTime = 0;
let laserRuneBeamCooldown = 0;
let laserRuneShotCooldownTimer = 0;
let laserRuneDeployStartTime = -100000;
let laserRuneFireConsumed = false;
let laserRuneShotTimer = 0;
let laserRunePowerupTimer = 0;
let laserRuneShotOriginLocked = false;
let laserRuneShotOriginWorldX = 0;
let laserRuneShotOriginWorldY = 0;
let laserRuneTargetWorldX = 0;
let laserRuneTargetWorldY = 0;
let laserRuneIconHeat = 0;
let laserBeamTileHeat = new Map();
let hotbar1Consumed = false;
let hotbar2Consumed = false;
let hotbar3Consumed = false;
let hotbar4Consumed = false;
let hotbar5Consumed = false;
let hotbar6Consumed = false;
let hotbar7Consumed = false;
let hotbar8Consumed = false;
let hotbar9Consumed = false;
let placeConsumed = false;
let craftingToggleConsumed = false;
let craftingMenuOpen = false;
const PICKAXE_SWING_DURATION = 0.18;
const PICKAXE_HAND_OFFSET_RIGHT_X = 22;
const PICKAXE_HAND_OFFSET_RIGHT_Y = 22;
const PICKAXE_HAND_OFFSET_LEFT_X = 9;
const PICKAXE_HAND_OFFSET_LEFT_Y = 22;
const LASER_RUNE_TICK_INTERVAL = 0.2;
const LASER_RUNE_MAX_HITS_PER_TICK = 64;
const LASER_RUNE_SHOT_SECONDS_PER_CRYSTAL = 2;
const LASER_RUNE_SHOT_COOLDOWN_SECONDS = 30;
const LASER_RUNE_POWERUP_SECONDS = 0.38;
const LASER_BEAM_HEAT_RISE_PER_SEC = 3.8;
const LASER_BEAM_HEAT_COOL_PER_SEC = 1.15;
const WILLOW_WOOD_DROP = 20;
const WILLOW_SEED_DROP = 2;
const WILLOW_GROW_MIN_MS = 3 * 60 * 1000;
const WILLOW_GROW_MAX_MS = 6 * 60 * 1000;
let hudToastText = '';
let hudToastTimer = 0;
let mouseCanvasX = null;
let mouseCanvasY = null;
let leftMouseDown = false;
let rightMouseDown = false;
const backpackRowLabels = {
    pickaxe: 'Pickaxe',
    hands: 'Hands',
    axe: 'Axe',
    dirt: 'Dirt',
    grass: 'Grass',
    stone: 'Stone',
    wood: 'Wood',
    bark: 'Bark',
    woodPlanks: 'Wood Planks',
    willowSeed: 'Willow Seeds',
    ladder: 'Ladder',
    pointer: 'Pointer',
    tripleJumpRune: 'Jump Rune',
    levitationRune: 'Levitation Rune',
    laserRune: 'Laser Rune',
    iron: 'Iron',
    gold: 'Gold',
    diamond: 'Diamond'
};
let backpackRowOrder = ['pickaxe', 'hands', 'axe', 'dirt', 'grass', 'stone', 'wood', 'bark', 'woodPlanks', 'willowSeed', 'ladder', 'pointer', 'tripleJumpRune', 'levitationRune', 'laserRune', 'iron', 'gold', 'diamond'];
let backpackRowDrag = null;
let craftingBackpackScroll = 0;
let craftingRecipeListScroll = 0;
let selectedCraftRecipeKey = 'tripleJumpRune';
const TRIPLE_JUMP_RUNE_RECIPE = {
    outputKey: 'tripleJumpRune',
    outputLabel: 'Triple Jump Rune',
    costs: {
        gold: 3,
        iron: 3,
        diamond: 3
    }
};
const LADDER_RECIPE = {
    outputKey: 'ladder',
    outputLabel: 'Ladder',
    costs: {
        wood: 1
    }
};
const POINTER_RECIPE = {
    outputKey: 'pointer',
    outputLabel: 'Pointer',
    costs: {
        wood: 2
    }
};
const AXE_RECIPE = {
    outputKey: 'axe',
    outputLabel: 'Axe',
    costs: {
        iron: 4
    }
};
const BARK_RECIPE = {
    outputKey: 'bark',
    outputLabel: 'Bark',
    costs: {
        wood: 1
    }
};
const WOOD_PLANKS_RECIPE = {
    outputKey: 'woodPlanks',
    outputLabel: 'Wood Planks',
    outputAmount: 2,
    costs: {
        wood: 1
    }
};
const LEVITATION_RUNE_RECIPE = {
    outputKey: 'levitationRune',
    outputLabel: 'Levitation Rune',
    costs: {
        gold: 3,
        iron: 3,
        diamond: 3
    }
};
const LASER_RUNE_RECIPE = {
    outputKey: 'laserRune',
    outputLabel: 'Laser Rune',
    costs: {
        gold: 0,
        iron: 0,
        diamond: 0
    }
};

function markGameStateDirty() {
    gameStateDirty = true;
}

function isBackpackRowAvailableForHotbar(rowKey) {
  if (rowKey === 'pickaxe') return (playerInventory.pickaxe ?? 0) > 0;
  if (rowKey === 'hands') return true;
  return (playerInventory.backpack[rowKey] ?? 0) > 0;
}

function syncHotbarToBackpackTopItems() {
  const nextSlots = HOTBAR_RESERVED_TOOL_SLOTS.slice();
  const seen = new Set(nextSlots.filter(Boolean));
  const backpackSlotsAvailable = HOTBAR_SLOT_COUNT - nextSlots.length;

  const ownedRows = [];
  const otherRows = [];
  for (const rowKey of backpackRowOrder) {
    if (!rowKey || seen.has(rowKey)) continue;
    if (isBackpackRowAvailableForHotbar(rowKey)) {
      ownedRows.push(rowKey);
    } else {
      otherRows.push(rowKey);
    }
  }

  const orderedRows = ownedRows.concat(otherRows);
  for (let i = 0; i < backpackSlotsAvailable; i++) {
    nextSlots.push(orderedRows[i] ?? null);
  }
  while (nextSlots.length < HOTBAR_SLOT_COUNT) nextSlots.push(null);
  hotbarSlots = nextSlots;
  if (selectedHotbarSlotIndex >= HOTBAR_SLOT_COUNT) selectedHotbarSlotIndex = 0;
  if (typeof syncEquippedToolToSelectedHotbarSlot === 'function') {
    syncEquippedToolToSelectedHotbarSlot();
  }
}

function getMaxJumps() {
  const runeCount = playerInventory.backpack.tripleJumpRune ?? 0;
  if (equippedTool !== 'Triple Jump Rune' || runeCount <= 0) return 2;
  return Math.min(6, 2 + runeCount);
}

function getLevitationRuneStacks() {
  const runeCount = playerInventory.backpack.levitationRune ?? 0;
  if (equippedTool !== 'Levitation Rune' || runeCount <= 0) return 0;
  return Math.min(3, runeCount);
}

function getLaserRuneStacks() {
  const runeCount = playerInventory.backpack.laserRune ?? 0;
  if (equippedTool !== 'Laser Rune' || runeCount <= 0) return 0;
  return Math.min(3, runeCount);
}

function getSurfaceGrassRow() {
  return EXTRA_TOP_AIR_ROWS + (MAP_ROWS - 2);
}

function createInitialWillowTrees() {
  const groundY = getSurfaceGrassRow() * TILE_SIZE;
  return [
    { id: 'willow-1', x: 2 * TILE_SIZE, baseY: groundY, variant: 1, cut: false },
    { id: 'willow-2', x: 10 * TILE_SIZE, baseY: groundY, variant: 2, cut: false },
    { id: 'willow-3', x: 19 * TILE_SIZE, baseY: groundY, variant: 3, cut: false },
    { id: 'willow-4', x: 28 * TILE_SIZE, baseY: groundY, variant: 1, cut: false },
    { id: 'willow-5', x: 35 * TILE_SIZE, baseY: groundY, variant: 2, cut: false }
  ];
}

let willowTrees = [];
let willowSeedlings = [];
let willowEntityIdCounter = 1000;
const HAUNTED_BIOME_START_COL = 120;
const HAUNTED_BIOME_END_COL = 220;
const HAUNTED_BIOME_FADE_COLS = 18;

function isInHauntedBiomeCol(col) {
  return col >= HAUNTED_BIOME_START_COL && col <= HAUNTED_BIOME_END_COL;
}

function getHauntedBiomeBlendForCol(col, fadeCols = HAUNTED_BIOME_FADE_COLS) {
  let distanceToBiome = 0;
  if (col < HAUNTED_BIOME_START_COL) {
    distanceToBiome = HAUNTED_BIOME_START_COL - col;
  } else if (col > HAUNTED_BIOME_END_COL) {
    distanceToBiome = col - HAUNTED_BIOME_END_COL;
  }
  return distanceToBiome <= 0 ? 1 : Math.max(0, 1 - (distanceToBiome / Math.max(1, fadeCols)));
}

function getCameraHauntedBiomeBlend() {
  const centerCol = Math.floor(((cameraX + (canvas.width / (2 * zoom))) / TILE_SIZE));
  return getHauntedBiomeBlendForCol(centerCol, HAUNTED_BIOME_FADE_COLS);
}

function getPlayerHauntedBiomeBlend() {
  const playerCenterCol = Math.floor((playerX + (frameWidth / 2)) / TILE_SIZE);
  return getHauntedBiomeBlendForCol(playerCenterCol, 10);
}

function nextWillowEntityId(prefix = 'willow') {
  willowEntityIdCounter += 1;
  return `${prefix}-${willowEntityIdCounter}`;
}

function getWillowTreeCol(tree) {
  return Math.floor((tree.x ?? 0) / TILE_SIZE);
}

function getWillowTreeRow(tree) {
  return Math.floor((tree.baseY ?? 0) / TILE_SIZE);
}

function getActiveWillowTreeAt(col, row) {
  for (const tree of willowTrees) {
    if (!tree || tree.cut) continue;
    if (getWillowTreeCol(tree) === col && getWillowTreeRow(tree) === row) return tree;
  }
  return null;
}

function getWillowSeedlingAt(col, row) {
  for (const seedling of willowSeedlings) {
    if (!seedling) continue;
    if (seedling.col === col && seedling.row === row) return seedling;
  }
  return null;
}

function createInitialAncientGraves() {
  const groundY = getSurfaceGrassRow() * TILE_SIZE;
  const graveCols = [124, 129, 136, 144, 151, 159, 168, 176, 185, 193, 201, 210, 217];
  return graveCols.map((col, i) => ({
    id: `grave-${i + 1}`,
    x: col * TILE_SIZE,
    baseY: groundY,
    variant: (i % 5) + 1
  }));
}

let ancientGraves = [];
function createInitialHauntedFlags() {
  const groundY = getSurfaceGrassRow() * TILE_SIZE;
  const flagCol = Math.floor((HAUNTED_BIOME_START_COL + HAUNTED_BIOME_END_COL) / 2);
  return [
    {
      id: 'haunted-flag-1',
      x: flagCol * TILE_SIZE,
      baseY: groundY
    }
  ];
}
let hauntedFlags = [];
const INDUSTRIAL_BUILDING_VARIANTS = [3, 4, 5];
const INDUSTRIAL_BUILDING_FALLBACK_W = 64;
const INDUSTRIAL_BUILDING_FALLBACK_H = 68;

function createInitialIndustrialBuildings() {
  const groundY = getSurfaceGrassRow() * TILE_SIZE;
  const rand = createSeededRandom(`${WORLD_SEED}:industrial-buildings`);
  const buildings = [];
  let nextId = 1;
  let col = Math.max(48, BASE_MAP_COLS + 6);

  while (col < LOGICAL_MAP_COLS - 8) {
    col += 8 + Math.floor(rand() * 18);
    if (col >= LOGICAL_MAP_COLS - 8) break;

    const variant = INDUSTRIAL_BUILDING_VARIANTS[Math.floor(rand() * INDUSTRIAL_BUILDING_VARIANTS.length)] ?? 3;
    const scale = 0.85 + (rand() * 0.85);
    const widthPx = Math.round(INDUSTRIAL_BUILDING_FALLBACK_W * scale);
    const widthCols = Math.max(2, Math.ceil(widthPx / TILE_SIZE));

    // Keep the haunted biome visually distinct and avoid clipping at the far edge.
    if (col <= HAUNTED_BIOME_END_COL + 2 && (col + widthCols) >= HAUNTED_BIOME_START_COL - 2) {
      col = HAUNTED_BIOME_END_COL + 8;
      continue;
    }
    if ((col + widthCols) >= LOGICAL_MAP_COLS - 2) break;

    buildings.push({
      id: `industrial-building-${nextId++}`,
      x: (col * TILE_SIZE) + Math.floor(rand() * 10),
      baseY: groundY + 2 + Math.floor(rand() * 6),
      variant,
      scale,
      alpha: 0.42 + (rand() * 0.2)
    });

    col += widthCols - 1;
  }

  return buildings;
}
let industrialBuildings = [];

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    keys[e.key] = true;
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    keys[e.key] = false;
});

function updateMouseCanvasPosition(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    mouseCanvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
    mouseCanvasY = (e.clientY - rect.top) * (canvas.height / rect.height);
}

function getCraftingMenuLayout() {
  const panelW = Math.min(420, canvas.width - 32);
  const panelH = Math.min(332, canvas.height - 40);
  const panelX = Math.round((canvas.width - panelW) / 2);
  const panelY = Math.round((canvas.height - panelH) / 2);
  const rowStartY = panelY + 60;
  const rowGap = 26;
  const backpackX = panelX + 14;
  const backpackW = Math.floor(panelW * 0.44);
  const backpackViewportY = rowStartY - 2;
  const backpackViewportH = Math.max(40, (panelY + panelH - 14) - backpackViewportY);
  return { panelW, panelH, panelX, panelY, rowStartY, rowGap, backpackX, backpackW, backpackViewportY, backpackViewportH };
}

function getCraftingBackpackScrollMetrics() {
  const { rowGap, backpackViewportH } = getCraftingMenuLayout();
  const contentHeight = Math.max(0, backpackRowOrder.length * rowGap);
  const maxScroll = Math.max(0, contentHeight - backpackViewportH);
  return { contentHeight, maxScroll };
}

function clampCraftingBackpackScroll() {
  const { maxScroll } = getCraftingBackpackScrollMetrics();
  craftingBackpackScroll = Math.max(0, Math.min(craftingBackpackScroll, maxScroll));
}

function getHotbarLayout() {
  const barWidth = (HOTBAR_SLOT_COUNT * HOTBAR_SLOT_SIZE) + ((HOTBAR_SLOT_COUNT - 1) * HOTBAR_SLOT_GAP) + 12;
  const barHeight = 44;
  const barX = Math.round((canvas.width - barWidth) / 2);
  const barY = canvas.height - barHeight - 12;
  return { barX, barY, barWidth, barHeight, slotSize: HOTBAR_SLOT_SIZE, slotGap: HOTBAR_SLOT_GAP };
}

function getHotbarSlotIndexAtCanvasPos(x, y) {
  if (x === null || y === null) return -1;
  const { barX, barY, slotSize, slotGap } = getHotbarLayout();
  const slotsY = barY + 6;
  if (y < slotsY || y > slotsY + slotSize) return -1;

  for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
    const slotX = barX + 6 + (i * (slotSize + slotGap));
    if (x >= slotX && x <= slotX + slotSize) {
      return i;
    }
  }
  return -1;
}

function getEquippedToolFromHotbarItem(itemKey) {
  if (itemKey === 'pickaxe') return 'Pickaxe';
  if (itemKey === 'hands') return 'Hands';
  if (itemKey === 'axe') return 'Axe';
  if (itemKey === 'dirt') return 'Dirt';
  if (itemKey === 'grass') return 'Grass';
  if (itemKey === 'ladder') return 'Ladder';
  if (itemKey === 'pointer') return 'Pointer';
  if (itemKey === 'tripleJumpRune') return 'Triple Jump Rune';
  if (itemKey === 'levitationRune') return 'Levitation Rune';
  if (itemKey === 'laserRune') return 'Laser Rune';
  if (itemKey === 'stone') return 'Stone';
  if (itemKey === 'wood') return 'Wood';
  if (itemKey === 'bark') return 'Bark';
  if (itemKey === 'woodPlanks') return 'Wood Planks';
  if (itemKey === 'willowSeed') return 'Willow Seed';
  if (itemKey === 'iron') return 'Iron Ore';
  if (itemKey === 'gold') return 'Gold Ore';
  if (itemKey === 'diamond') return 'Diamond';
  return null;
}

function equipHotbarSlot(slotIndex, showToast = true) {
  if (slotIndex < 0 || slotIndex >= hotbarSlots.length) return false;
  const slotItem = hotbarSlots[slotIndex];
  const nextTool = getEquippedToolFromHotbarItem(slotItem);
  const previousTool = equippedTool;
  if (!nextTool) return false;
  if (slotItem === 'pickaxe' && playerInventory.pickaxe <= 0) return false;
  if (
    slotItem &&
    slotItem !== 'pickaxe' &&
    slotItem !== 'hands' &&
    (playerInventory.backpack[slotItem] ?? 0) <= 0
  ) return false;
  if (slotItem === 'ladder' && (playerInventory.backpack.ladder ?? 0) <= 0) return false;
  if (slotItem === 'tripleJumpRune' && (playerInventory.backpack.tripleJumpRune ?? 0) <= 0) return false;
  if (slotItem === 'levitationRune' && (playerInventory.backpack.levitationRune ?? 0) <= 0) return false;
  if (slotItem === 'laserRune' && (playerInventory.backpack.laserRune ?? 0) <= 0) return false;

  selectedHotbarSlotIndex = slotIndex;
  equippedTool = nextTool;
  if (nextTool === 'Laser Rune' && previousTool !== 'Laser Rune') {
    laserRuneDeployStartTime = performance.now();
  }
  if (nextTool !== 'Pickaxe') {
    pickaxeSwingTime = 0;
  }

  if (showToast) {
    if (nextTool === 'Pickaxe') setHudToast('Pickaxe equipped');
    if (nextTool === 'Hands') setHudToast('Hands equipped');
    if (nextTool === 'Axe') setHudToast('Axe equipped');
    if (nextTool === 'Dirt') setHudToast(`Dirt ${playerInventory.backpack.dirt ?? 0}`);
    if (nextTool === 'Grass') setHudToast(`Grass ${playerInventory.backpack.grass ?? 0}`);
    if (nextTool === 'Ladder') setHudToast(`Ladders ${playerInventory.backpack.ladder ?? 0}`);
    if (nextTool === 'Pointer') setHudToast(`Pointers ${playerInventory.backpack.pointer ?? 0}`);
    if (nextTool === 'Triple Jump Rune') setHudToast('Triple jump ready');
    if (nextTool === 'Levitation Rune') setHudToast('Levitation ready');
    if (nextTool === 'Laser Rune') setHudToast('Laser ready');
    if (nextTool === 'Stone') setHudToast(`Stone ${playerInventory.backpack.stone ?? 0}`);
    if (nextTool === 'Wood') setHudToast(`Wood ${playerInventory.backpack.wood ?? 0}`);
    if (nextTool === 'Bark') setHudToast(`Bark ${playerInventory.backpack.bark ?? 0}`);
    if (nextTool === 'Wood Planks') setHudToast(`Planks ${playerInventory.backpack.woodPlanks ?? 0}`);
    if (nextTool === 'Willow Seed') setHudToast(`Willow Seeds ${playerInventory.backpack.willowSeed ?? 0}`);
    if (nextTool === 'Iron Ore') setHudToast(`Iron ${playerInventory.backpack.iron ?? 0}`);
    if (nextTool === 'Gold Ore') setHudToast(`Gold ${playerInventory.backpack.gold ?? 0}`);
    if (nextTool === 'Diamond') setHudToast(`Diamond ${playerInventory.backpack.diamond ?? 0}`);
  }
  markGameStateDirty();
  return true;
}

function syncEquippedToolToSelectedHotbarSlot() {
  equipHotbarSlot(selectedHotbarSlotIndex, false);
}

function moveHotbarSlot(fromIndex, toIndex) {
  if (fromIndex === toIndex) return false;
  if (fromIndex < 0 || toIndex < 0) return false;
  if (fromIndex >= hotbarSlots.length || toIndex >= hotbarSlots.length) return false;

  const [movedItem] = hotbarSlots.splice(fromIndex, 1);
  hotbarSlots.splice(toIndex, 0, movedItem);

  if (selectedHotbarSlotIndex === fromIndex) {
    selectedHotbarSlotIndex = toIndex;
  } else if (fromIndex < selectedHotbarSlotIndex && toIndex >= selectedHotbarSlotIndex) {
    selectedHotbarSlotIndex -= 1;
  } else if (fromIndex > selectedHotbarSlotIndex && toIndex <= selectedHotbarSlotIndex) {
    selectedHotbarSlotIndex += 1;
  }

  syncEquippedToolToSelectedHotbarSlot();
  markGameStateDirty();
  return true;
}

function getBackpackRowIndexAtCanvasPos(x, y) {
  if (!craftingMenuOpen || x === null || y === null) return -1;
  const layout = getCraftingMenuLayout();
  if (x < layout.backpackX || x > layout.backpackX + layout.backpackW) return -1;
  if (y < layout.backpackViewportY || y > layout.backpackViewportY + layout.backpackViewportH) return -1;
  clampCraftingBackpackScroll();
  const scrollOffsetRows = craftingBackpackScroll;

  for (let i = 0; i < backpackRowOrder.length; i++) {
    const rowY = layout.rowStartY + (i * layout.rowGap) - scrollOffsetRows;
    if (y >= rowY - 2 && y <= rowY + 20) {
      return i;
    }
  }

  return -1;
}

function moveBackpackRow(fromIndex, toIndex) {
  if (fromIndex === toIndex) return false;
  if (fromIndex < 0 || toIndex < 0) return false;
  if (fromIndex >= backpackRowOrder.length || toIndex >= backpackRowOrder.length) return false;
  const [movedKey] = backpackRowOrder.splice(fromIndex, 1);
  backpackRowOrder.splice(toIndex, 0, movedKey);
  syncHotbarToBackpackTopItems();
  markGameStateDirty();
  return true;
}

function pointInRect(x, y, rect) {
  return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function getCraftingRecipeLayout() {
  const { panelW, panelX, panelY, rowStartY } = getCraftingMenuLayout();
  const recipeX = panelX + Math.floor(panelW * 0.52);
  const recipeW = panelX + panelW - 14 - recipeX;
  const cardY = rowStartY - 2;
  const cardH = 254;
  const listRect = {
    x: recipeX + 8,
    y: cardY + 8,
    w: recipeW - 16,
    h: 122
  };
  const detailRect = {
    x: recipeX + 8,
    y: listRect.y + listRect.h + 6,
    w: recipeW - 16,
    h: cardH - (listRect.h + 22)
  };
  const craftButtonRect = {
    x: detailRect.x + 8,
    y: detailRect.y + detailRect.h - 24,
    w: detailRect.w - 16,
    h: 24
  };
  return { recipeX, recipeW, cardY, cardH, listRect, detailRect, craftButtonRect };
}

function getCraftingRecipeListScrollMetrics() {
  const { listRect } = getCraftingRecipeLayout();
  const entryCount = getCraftingRecipeEntries().length;
  const rowStride = 22;
  const rowHeight = 20;
  const topPad = 4;
  const bottomPad = 4;
  const rowsHeight = entryCount > 0 ? (((entryCount - 1) * rowStride) + rowHeight) : 0;
  const contentHeight = Math.max(0, topPad + rowsHeight + bottomPad);
  const maxScroll = Math.max(0, contentHeight - listRect.h);
  return { contentHeight, maxScroll };
}

function clampCraftingRecipeListScroll() {
  const { maxScroll } = getCraftingRecipeListScrollMetrics();
  craftingRecipeListScroll = Math.max(0, Math.min(craftingRecipeListScroll, maxScroll));
}

function getCraftingRecipeEntries() {
  return [
    {
      key: 'tripleJumpRune',
      label: 'Triple Jump Rune',
      iconKey: 'tripleJumpRune',
      descriptionLines: ['Hold in hand: +1 jump per rune', '(max 6 jumps total)'],
      costs: [
        ['gold', TRIPLE_JUMP_RUNE_RECIPE.costs.gold],
        ['iron', TRIPLE_JUMP_RUNE_RECIPE.costs.iron],
        ['diamond', TRIPLE_JUMP_RUNE_RECIPE.costs.diamond]
      ],
      owned: playerInventory.backpack.tripleJumpRune ?? 0,
      ownedCap: getBackpackCapacity('tripleJumpRune'),
      canCraft: canCraftTripleJumpRune,
      craft: craftTripleJumpRune
    },
    {
      key: 'levitationRune',
      label: 'Levitation Rune',
      iconKey: 'levitationRune',
      descriptionLines: ['Hold in hand: float to mouse', '(stacks to 3, faster/higher)'],
      costs: [
        ['gold', LEVITATION_RUNE_RECIPE.costs.gold],
        ['iron', LEVITATION_RUNE_RECIPE.costs.iron],
        ['diamond', LEVITATION_RUNE_RECIPE.costs.diamond]
      ],
      owned: playerInventory.backpack.levitationRune ?? 0,
      ownedCap: getBackpackCapacity('levitationRune'),
      canCraft: canCraftLevitationRune,
      craft: craftLevitationRune
    },
    {
      key: 'laserRune',
      label: 'Laser Rune',
      iconKey: 'laserRune',
      descriptionLines: ['Hold in hand: green beam to mouse', '(vaporizes blocks in beam radius)'],
      costs: [
        ['gold', LASER_RUNE_RECIPE.costs.gold],
        ['iron', LASER_RUNE_RECIPE.costs.iron],
        ['diamond', LASER_RUNE_RECIPE.costs.diamond]
      ],
      owned: playerInventory.backpack.laserRune ?? 0,
      ownedCap: getBackpackCapacity('laserRune'),
      canCraft: canCraftLaserRune,
      craft: craftLaserRune
    },
    {
      key: 'axe',
      label: 'Axe',
      iconKey: 'axe',
      descriptionLines: ['Chops down willow trees.', 'Required for tree cutting.'],
      costs: [['iron', AXE_RECIPE.costs.iron]],
      owned: playerInventory.backpack.axe ?? 0,
      ownedCap: getBackpackCapacity('axe'),
      canCraft: canCraftAxe,
      craft: craftAxe
    },
    {
      key: 'ladder',
      label: 'Ladder',
      iconKey: 'ladder',
      descriptionLines: ['Simple climbing ladder.', 'Place in foreground.'],
      costs: [['wood', LADDER_RECIPE.costs.wood]],
      owned: playerInventory.backpack.ladder ?? 0,
      ownedCap: getBackpackCapacity('ladder'),
      canCraft: canCraftLadder,
      craft: craftLadder
    },
    {
      key: 'pointer',
      label: 'Pointer',
      iconKey: 'pointer',
      descriptionLines: ['Decorative sign pointer.', 'Place in foreground.'],
      costs: [['wood', POINTER_RECIPE.costs.wood]],
      owned: playerInventory.backpack.pointer ?? 0,
      ownedCap: getBackpackCapacity('pointer'),
      canCraft: canCraftPointer,
      craft: craftPointer
    },
    {
      key: 'bark',
      label: 'Bark',
      iconKey: 'bark',
      descriptionLines: ['Peel bark from wood.', 'Useful crafting material.'],
      costs: [['wood', BARK_RECIPE.costs.wood]],
      owned: playerInventory.backpack.bark ?? 0,
      ownedCap: getBackpackCapacity('bark'),
      canCraft: canCraftBark,
      craft: craftBark
    },
    {
      key: 'woodPlanks',
      label: 'Wood Planks',
      iconKey: 'woodPlanks',
      descriptionLines: ['Saw wood into planks.', 'Crafts 2 planks per wood.'],
      costs: [['wood', WOOD_PLANKS_RECIPE.costs.wood]],
      owned: playerInventory.backpack.woodPlanks ?? 0,
      ownedCap: getBackpackCapacity('woodPlanks'),
      canCraft: canCraftWoodPlanks,
      craft: craftWoodPlanks
    }
  ];
}

function getSelectedCraftRecipeEntry() {
  const entries = getCraftingRecipeEntries();
  const selected = entries.find((entry) => entry.key === selectedCraftRecipeKey);
  return selected || entries[0];
}

function getCraftingRecipeListRowRect(index) {
  const { listRect } = getCraftingRecipeLayout();
  const { maxScroll } = getCraftingRecipeListScrollMetrics();
  const scrollbarReserve = maxScroll > 0 ? 10 : 0;
  return {
    x: listRect.x + 4,
    y: listRect.y + 4 + (index * 22) - craftingRecipeListScroll,
    w: listRect.w - 8 - scrollbarReserve,
    h: 20
  };
}

function getCraftingRecipeIndexAtCanvasPos(x, y) {
  if (!craftingMenuOpen || x === null || y === null) return -1;
  const { listRect } = getCraftingRecipeLayout();
  if (!pointInRect(x, y, listRect)) return -1;
  clampCraftingRecipeListScroll();
  const entries = getCraftingRecipeEntries();
  for (let i = 0; i < entries.length; i++) {
    if (pointInRect(x, y, getCraftingRecipeListRowRect(i))) return i;
  }
  return -1;
}

function canCraftTripleJumpRune() {
  const { gold, iron, diamond } = TRIPLE_JUMP_RUNE_RECIPE.costs;
  if ((playerInventory.backpack.gold ?? 0) < gold) return { ok: false, reason: 'Need more gold' };
  if ((playerInventory.backpack.iron ?? 0) < iron) return { ok: false, reason: 'Need more iron' };
  if ((playerInventory.backpack.diamond ?? 0) < diamond) return { ok: false, reason: 'Need more diamond' };
  return { ok: true, reason: '' };
}

function canCraftLevitationRune() {
  const { gold, iron, diamond } = LEVITATION_RUNE_RECIPE.costs;
  if ((playerInventory.backpack.gold ?? 0) < gold) return { ok: false, reason: 'Need more gold' };
  if ((playerInventory.backpack.iron ?? 0) < iron) return { ok: false, reason: 'Need more iron' };
  if ((playerInventory.backpack.diamond ?? 0) < diamond) return { ok: false, reason: 'Need more diamond' };
  return { ok: true, reason: '' };
}

function canCraftLaserRune() {
  const owned = playerInventory.backpack.laserRune ?? 0;
  const cap = getBackpackCapacity('laserRune');
  if (owned >= cap) return { ok: false, reason: 'Laser runes full' };
  const { gold, iron, diamond } = LASER_RUNE_RECIPE.costs;
  if ((playerInventory.backpack.gold ?? 0) < gold) return { ok: false, reason: 'Need more gold' };
  if ((playerInventory.backpack.iron ?? 0) < iron) return { ok: false, reason: 'Need more iron' };
  if ((playerInventory.backpack.diamond ?? 0) < diamond) return { ok: false, reason: 'Need more diamond' };
  return { ok: true, reason: '' };
}

function ensureHotbarHasTripleJumpRune() {
  if (hotbarSlots.includes('tripleJumpRune')) return;
  const emptySlotIndex = hotbarSlots.findIndex((slot) => slot === null);
  if (emptySlotIndex >= 0) {
    hotbarSlots[emptySlotIndex] = 'tripleJumpRune';
  } else {
    hotbarSlots[hotbarSlots.length - 1] = 'tripleJumpRune';
  }
}

function canCraftLadder() {
  const neededWood = LADDER_RECIPE.costs.wood;
  if ((playerInventory.backpack.wood ?? 0) < neededWood) return { ok: false, reason: 'Need more wood' };
  return { ok: true, reason: '' };
}

function canCraftPointer() {
  const neededWood = POINTER_RECIPE.costs.wood;
  if ((playerInventory.backpack.wood ?? 0) < neededWood) return { ok: false, reason: 'Need more wood' };
  return { ok: true, reason: '' };
}

function canCraftAxe() {
  const neededIron = AXE_RECIPE.costs.iron;
  if ((playerInventory.backpack.iron ?? 0) < neededIron) return { ok: false, reason: 'Need more iron' };
  const owned = playerInventory.backpack.axe ?? 0;
  const cap = getBackpackCapacity('axe');
  if (owned >= cap) return { ok: false, reason: 'Axe owned' };
  return { ok: true, reason: '' };
}

function canCraftBark() {
  const neededWood = BARK_RECIPE.costs.wood;
  if ((playerInventory.backpack.wood ?? 0) < neededWood) return { ok: false, reason: 'Need more wood' };
  const owned = playerInventory.backpack.bark ?? 0;
  const cap = getBackpackCapacity('bark');
  if (owned >= cap) return { ok: false, reason: 'Bark full' };
  return { ok: true, reason: '' };
}

function canCraftWoodPlanks() {
  const neededWood = WOOD_PLANKS_RECIPE.costs.wood;
  if ((playerInventory.backpack.wood ?? 0) < neededWood) return { ok: false, reason: 'Need more wood' };
  const owned = playerInventory.backpack.woodPlanks ?? 0;
  const cap = getBackpackCapacity('woodPlanks');
  if (owned + WOOD_PLANKS_RECIPE.outputAmount > cap) return { ok: false, reason: 'Planks full' };
  return { ok: true, reason: '' };
}

function ensureHotbarHasLadder() {
  if (hotbarSlots.includes('ladder')) return;
  const emptySlotIndex = hotbarSlots.findIndex((slot) => slot === null);
  if (emptySlotIndex >= 0) {
    hotbarSlots[emptySlotIndex] = 'ladder';
  } else {
    hotbarSlots[hotbarSlots.length - 1] = 'ladder';
  }
}

function ensureHotbarHasPointer() {
  if (hotbarSlots.includes('pointer')) return;
  const emptySlotIndex = hotbarSlots.findIndex((slot) => slot === null);
  if (emptySlotIndex >= 0) {
    hotbarSlots[emptySlotIndex] = 'pointer';
  } else {
    hotbarSlots[hotbarSlots.length - 1] = 'pointer';
  }
}

function ensureHotbarHasAxe() {
  if (hotbarSlots.includes('axe')) return;
  const emptySlotIndex = hotbarSlots.findIndex((slot) => slot === null);
  if (emptySlotIndex >= 0) {
    hotbarSlots[emptySlotIndex] = 'axe';
  } else {
    hotbarSlots[hotbarSlots.length - 1] = 'axe';
  }
}

function ensureHotbarHasLevitationRune() {
  if (hotbarSlots.includes('levitationRune')) return;
  const emptySlotIndex = hotbarSlots.findIndex((slot) => slot === null);
  if (emptySlotIndex >= 0) {
    hotbarSlots[emptySlotIndex] = 'levitationRune';
  } else {
    hotbarSlots[hotbarSlots.length - 1] = 'levitationRune';
  }
}

function ensureHotbarHasLaserRune() {
  if (hotbarSlots.includes('laserRune')) return;
  const emptySlotIndex = hotbarSlots.findIndex((slot) => slot === null);
  if (emptySlotIndex >= 0) {
    hotbarSlots[emptySlotIndex] = 'laserRune';
  } else {
    hotbarSlots[hotbarSlots.length - 1] = 'laserRune';
  }
}

function craftTripleJumpRune() {
  const craftCheck = canCraftTripleJumpRune();
  if (!craftCheck.ok) {
    setHudToast(craftCheck.reason);
    return false;
  }

  removeFromBackpack('gold', TRIPLE_JUMP_RUNE_RECIPE.costs.gold);
  removeFromBackpack('iron', TRIPLE_JUMP_RUNE_RECIPE.costs.iron);
  removeFromBackpack('diamond', TRIPLE_JUMP_RUNE_RECIPE.costs.diamond);
  addToBackpack('tripleJumpRune', 1);
  ensureHotbarHasTripleJumpRune();
  markGameStateDirty();
  setHudToast('Crafted Triple Jump Rune');
  return true;
}

function craftLevitationRune() {
  const craftCheck = canCraftLevitationRune();
  if (!craftCheck.ok) {
    setHudToast(craftCheck.reason);
    return false;
  }

  removeFromBackpack('gold', LEVITATION_RUNE_RECIPE.costs.gold);
  removeFromBackpack('iron', LEVITATION_RUNE_RECIPE.costs.iron);
  removeFromBackpack('diamond', LEVITATION_RUNE_RECIPE.costs.diamond);
  addToBackpack('levitationRune', 1);
  ensureHotbarHasLevitationRune();
  markGameStateDirty();
  setHudToast('Crafted Levitation Rune');
  return true;
}

function craftLaserRune() {
  const craftCheck = canCraftLaserRune();
  if (!craftCheck.ok) {
    setHudToast(craftCheck.reason);
    return false;
  }

  removeFromBackpack('gold', LASER_RUNE_RECIPE.costs.gold);
  removeFromBackpack('iron', LASER_RUNE_RECIPE.costs.iron);
  removeFromBackpack('diamond', LASER_RUNE_RECIPE.costs.diamond);
  addToBackpack('laserRune', 1);
  ensureHotbarHasLaserRune();
  markGameStateDirty();
  setHudToast('Crafted Laser Rune');
  return true;
}

function craftLadder() {
  const craftCheck = canCraftLadder();
  if (!craftCheck.ok) {
    setHudToast(craftCheck.reason);
    return false;
  }
  removeFromBackpack('wood', LADDER_RECIPE.costs.wood);
  addToBackpack('ladder', 1);
  ensureHotbarHasLadder();
  markGameStateDirty();
  setHudToast('Crafted Ladder');
  return true;
}

function craftPointer() {
  const craftCheck = canCraftPointer();
  if (!craftCheck.ok) {
    setHudToast(craftCheck.reason);
    return false;
  }
  removeFromBackpack('wood', POINTER_RECIPE.costs.wood);
  addToBackpack('pointer', 1);
  ensureHotbarHasPointer();
  markGameStateDirty();
  setHudToast('Crafted Pointer');
  return true;
}

function craftAxe() {
  const craftCheck = canCraftAxe();
  if (!craftCheck.ok) {
    setHudToast(craftCheck.reason);
    return false;
  }
  removeFromBackpack('iron', AXE_RECIPE.costs.iron);
  addToBackpack('axe', 1);
  ensureHotbarHasAxe();
  markGameStateDirty();
  setHudToast('Crafted Axe');
  return true;
}

function craftBark() {
  const craftCheck = canCraftBark();
  if (!craftCheck.ok) {
    setHudToast(craftCheck.reason);
    return false;
  }
  removeFromBackpack('wood', BARK_RECIPE.costs.wood);
  addToBackpack('bark', 1);
  markGameStateDirty();
  setHudToast('Crafted Bark');
  return true;
}

function craftWoodPlanks() {
  const craftCheck = canCraftWoodPlanks();
  if (!craftCheck.ok) {
    setHudToast(craftCheck.reason);
    return false;
  }
  removeFromBackpack('wood', WOOD_PLANKS_RECIPE.costs.wood);
  addToBackpack('woodPlanks', WOOD_PLANKS_RECIPE.outputAmount);
  markGameStateDirty();
  setHudToast(`Crafted ${WOOD_PLANKS_RECIPE.outputAmount} Wood Planks`);
  return true;
}

canvas.addEventListener('mousemove', updateMouseCanvasPosition);
canvas.addEventListener('mousemove', () => {
    if (!backpackRowDrag || !leftMouseDown) return;
    const hoveredRowIndex = getBackpackRowIndexAtCanvasPos(mouseCanvasX, mouseCanvasY);
    if (hoveredRowIndex < 0 || hoveredRowIndex === backpackRowDrag.rowIndex) return;
    if (moveBackpackRow(backpackRowDrag.rowIndex, hoveredRowIndex)) {
        backpackRowDrag.rowIndex = hoveredRowIndex;
    }
});
canvas.addEventListener('mousemove', () => {
    if (!hotbarDrag || !leftMouseDown || craftingMenuOpen) return;
    const hoveredSlotIndex = getHotbarSlotIndexAtCanvasPos(mouseCanvasX, mouseCanvasY);
    if (hoveredSlotIndex < 0 || hoveredSlotIndex === hotbarDrag.slotIndex) return;
    if (moveHotbarSlot(hotbarDrag.slotIndex, hoveredSlotIndex)) {
        hotbarDrag.slotIndex = hoveredSlotIndex;
    }
});
canvas.addEventListener('wheel', (e) => {
    updateMouseCanvasPosition(e);
    if (!craftingMenuOpen) return;
    const layout = getCraftingMenuLayout();
    const recipeLayout = getCraftingRecipeLayout();
    const withinBackpack =
        mouseCanvasX !== null &&
        mouseCanvasY !== null &&
        mouseCanvasX >= layout.backpackX &&
        mouseCanvasX <= layout.backpackX + layout.backpackW &&
        mouseCanvasY >= layout.backpackViewportY &&
        mouseCanvasY <= layout.backpackViewportY + layout.backpackViewportH;
    const withinRecipeList =
        mouseCanvasX !== null &&
        mouseCanvasY !== null &&
        pointInRect(mouseCanvasX, mouseCanvasY, recipeLayout.listRect);
    if (!withinBackpack && !withinRecipeList) return;

    if (withinRecipeList) {
        const { maxScroll: recipeMaxScroll } = getCraftingRecipeListScrollMetrics();
        if (recipeMaxScroll <= 0) return;
        craftingRecipeListScroll += Math.sign(e.deltaY) * 22;
        clampCraftingRecipeListScroll();
        e.preventDefault();
        return;
    }

    const { maxScroll } = getCraftingBackpackScrollMetrics();
    if (maxScroll <= 0) return;

    craftingBackpackScroll += Math.sign(e.deltaY) * 22;
    clampCraftingBackpackScroll();
    e.preventDefault();
}, { passive: false });
canvas.addEventListener('mouseenter', updateMouseCanvasPosition);
canvas.addEventListener('mouseleave', () => {
    mouseCanvasX = null;
    mouseCanvasY = null;
});
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});
canvas.addEventListener('mousedown', (e) => {
    updateMouseCanvasPosition(e);
    if (e.button === 0) {
        leftMouseDown = true;
        if (craftingMenuOpen) {
            const recipeIndex = getCraftingRecipeIndexAtCanvasPos(mouseCanvasX, mouseCanvasY);
            if (recipeIndex >= 0) {
                const entries = getCraftingRecipeEntries();
                selectedCraftRecipeKey = entries[recipeIndex].key;
            } else {
                const { craftButtonRect } = getCraftingRecipeLayout();
                if (pointInRect(mouseCanvasX, mouseCanvasY, craftButtonRect)) {
                    const selectedRecipe = getSelectedCraftRecipeEntry();
                    if (selectedRecipe?.craft) {
                        selectedRecipe.craft();
                    }
                }
            }
        }
        if (!craftingMenuOpen) {
            const clickedHotbarSlot = getHotbarSlotIndexAtCanvasPos(mouseCanvasX, mouseCanvasY);
            if (clickedHotbarSlot >= 0) {
                equipHotbarSlot(clickedHotbarSlot);
                hotbarDrag = { slotIndex: clickedHotbarSlot };
            }
        }
        const clickedRowIndex = getBackpackRowIndexAtCanvasPos(mouseCanvasX, mouseCanvasY);
        if (clickedRowIndex >= 0) {
            backpackRowDrag = { rowIndex: clickedRowIndex };
        }
    }
    if (e.button === 2) {
        rightMouseDown = true;
        e.preventDefault();
    }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
        leftMouseDown = false;
        hotbarDrag = null;
        backpackRowDrag = null;
    }
    if (e.button === 2) {
        rightMouseDown = false;
    }
});

let velocityY = 0;
const gravity = 1800;
const jumpForce = -650;
const FALL_BRAKE_FALL_SPEED_MULTIPLIER = 0.5;
const FALL_BRAKE_IDLE_MOVE_SPEED_MULTIPLIER = 2;
let onGround = true;
let jumping = false;
let attacking = false;
let jumpsRemaining = 2;
let climbing = false;

const tileSetImg = document.getElementById("tileSet");
const ladderBottomImg = document.getElementById("ladderBottom");
const ladderMiddleImg = document.getElementById("ladderMiddle");
const ladderTopImg = document.getElementById("ladderTop");
const bushForegroundImgs = {};
for (let i = 1; i <= 9; i++) {
  const img = new Image();
  img.src = `Bushes/${i}.png`;
  bushForegroundImgs[i] = img;
}
const willowTreeImgs = {};
for (let i = 1; i <= 3; i++) {
  const img = new Image();
  img.src = `Trees/Willows/${i}.png`;
  willowTreeImgs[i] = img;
}
const ancientGraveImgs = {};
for (let i = 1; i <= 5; i++) {
  const img = new Image();
  img.src = `AncientGrave/${i}.png`;
  ancientGraveImgs[i] = img;
}
const industrialBuildingImgs = {};
for (const variant of INDUSTRIAL_BUILDING_VARIANTS) {
  const img = new Image();
  img.src = `craftpix-net-314143-free-industrial-zone-tileset-pixel-art/2 Background/${variant}.png`;
  industrialBuildingImgs[variant] = img;
}
const pointerForegroundImgs = {};
pointerForegroundImgs[1] = new Image();
pointerForegroundImgs[1].src = 'craftpix-net-314143-free-industrial-zone-tileset-pixel-art/3 Objects/Pointer1.png';
pointerForegroundImgs[2] = new Image();
pointerForegroundImgs[2].src = 'craftpix-net-314143-free-industrial-zone-tileset-pixel-art/3 Objects/Pointer2.png';
const hauntedFlagImg = new Image();
hauntedFlagImg.src = 'AncientGrave/Flag.png';
const diamondImg = document.getElementById("diamondSprite");
const ironImg = document.getElementById("ironSprite");
const goldImg = document.getElementById("goldSprite");
const stoneTileImg = document.getElementById("stoneSprite");
const barkImg = document.getElementById("barkSprite");
const woodPlanksImg = document.getElementById("woodPlanksSprite");
const runeSpriteImg = document.getElementById("runeSprite");
const diamondIconImg = document.getElementById("diamondIconSprite");
const ironIconImg = document.getElementById("ironIconSprite");
const goldIconImg = document.getElementById("goldIconSprite");
const pickaxeImg = document.getElementById("pickaxeSprite");
const axeImg = document.getElementById("axeSprite");
const TILE_SIZE = 32; 
const MAP_COLS = 40;
const MAP_ROWS = 15;
const TOP_WORLD_HEIGHT_MULTIPLIER = 3;
const EXTRA_DIRT_ROWS = 80;
const STONE_TILE_INDEX = 100; // custom terrain tile id rendered from stone.png (not Tileset.png)
const BARK_TILE_INDEX = 101; // custom terrain tile id rendered from Bark.png (not Tileset.png)
const LOOK_DOWN_PIXELS = EXTRA_DIRT_ROWS * TILE_SIZE;
const LOOK_DOWN_HOLD_DELAY = 1.0;
const CAMERA_BREATH_X = 1.5;
const CAMERA_BREATH_Y = 2.5;
const CAMERA_BREATH_SPEED = 2.2;
let SURFACE_FLOOR_Y = ((MAP_ROWS - 2) * TILE_SIZE) - frameHeight;
const MAX_BACKGROUND_DEPTH_FADE = 0.96;
const LADDER_TILE_START = 1; // start piece (top of ladder)
const LADDER_TILE_MIDDLE = 2;
const LADDER_TILE_END = 3;   // end piece (bottom of ladder)
// Backward-compatible aliases used throughout the codebase.
const LADDER_TILE_TOP = LADDER_TILE_START;
const LADDER_TILE_BOTTOM = LADDER_TILE_END;
const POINTER_TILE_RIGHT = 13;
const POINTER_TILE_LEFT = 14;
const EXTRA_BASE_MAP_ROWS = 12; // Extra editable rows added to mapData + foreground before generated depth

// Layered tilemap:
// `layer1` = terrain tileset indices
// `foreground` = foreground decorations / climbables
//   0 none
//   1-3 ladder tiles (start/middle/end)
//   4+ decorative bushes / pointers (mapped below)
// `ores` = ore overlay tiles (0 none, 1 diamond, 2 iron, 3 gold)
const mapData = {
  layer1: [
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
    [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ,1 ,1, 1, 1, 1],
    [ 11, 11,11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11 ,11 ,11 ,11, 11, 11]
  ],
  foreground: [
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  ],
  ores: Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(0)),
  minedBackdrop: Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(-1))
};
for (let i = 0; i < EXTRA_BASE_MAP_ROWS; i++) {
  mapData.layer1.push(new Array(MAP_COLS).fill(11));
  mapData.foreground.push(new Array(MAP_COLS).fill(0));
  mapData.ores.push(new Array(MAP_COLS).fill(0));
  mapData.minedBackdrop.push(new Array(MAP_COLS).fill(-1));
}
for (let i = 0; i < EXTRA_DIRT_ROWS; i++) {
  mapData.layer1.push(new Array(MAP_COLS).fill(11));
  mapData.foreground.push(new Array(MAP_COLS).fill(0));
  mapData.ores.push(new Array(MAP_COLS).fill(0));
  mapData.minedBackdrop.push(new Array(MAP_COLS).fill(-1));
}

const EXTRA_TOP_AIR_ROWS = Math.max(0, (MAP_ROWS - 2) * (TOP_WORLD_HEIGHT_MULTIPLIER - 1));
for (let i = 0; i < EXTRA_TOP_AIR_ROWS; i++) {
  mapData.layer1.unshift(new Array(MAP_COLS).fill(-1));
  mapData.foreground.unshift(new Array(MAP_COLS).fill(0));
  mapData.ores.unshift(new Array(MAP_COLS).fill(0));
  mapData.minedBackdrop.unshift(new Array(MAP_COLS).fill(-1));
}
SURFACE_FLOOR_Y += EXTRA_TOP_AIR_ROWS * TILE_SIZE;
const SURFACE_CAMERA_BASE_Y = EXTRA_TOP_AIR_ROWS * TILE_SIZE;
willowTrees = createInitialWillowTrees();
ancientGraves = createInitialAncientGraves();
hauntedFlags = createInitialHauntedFlags();

const terrainLayer = mapData.layer1;
const foregroundLayer = mapData.foreground;
const oreLayer = mapData.ores;
const minedBackdropLayer = mapData.minedBackdrop;
const FOREGROUND_BUSH_VARIANT_BY_TILE = {
  4: 4, // foreground value 4 -> Bushes/4.png
  5: 2, // foreground value 5 -> Bushes/2.png
  6: 1,
  7: 3,
  8: 5,
  9: 6,
  10: 7,
  11: 8,
  12: 9
};
const FOREGROUND_POINTER_VARIANT_BY_TILE = {
  [POINTER_TILE_RIGHT]: 1,
  [POINTER_TILE_LEFT]: 2
};

// Sample foreground bushes near the surface. Values 1-3 remain reserved for ladders.
[
  [3, 12, 4],
  [5, 12, 5],
  [14, 12, 6],
  [18, 12, 7],
  [25, 12, 8],
  [30, 12, 9],
  [34, 12, 10]
].forEach(([col, row, tileValue]) => {
  row += EXTRA_TOP_AIR_ROWS;
  if (row >= 0 && row < foregroundLayer.length && col >= 0 && col < foregroundLayer[0].length && foregroundLayer[row][col] === 0) {
    foregroundLayer[row][col] = tileValue;
  }
});

// Sample decorative pointers scattered across the map.
[
  [7, 12, POINTER_TILE_RIGHT],
  [16, 12, POINTER_TILE_LEFT],
  [22, 12, POINTER_TILE_RIGHT],
  [32, 12, POINTER_TILE_LEFT]
].forEach(([col, row, tileValue]) => {
  row += EXTRA_TOP_AIR_ROWS;
  if (row >= 0 && row < foregroundLayer.length && col >= 0 && col < foregroundLayer[0].length && foregroundLayer[row][col] === 0) {
    foregroundLayer[row][col] = tileValue;
  }
});

function getTerrainTileAt(col, row) {
  if (row < 0 || row >= terrainLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return -1;
  const rowData = terrainLayer[row];
  const tile = rowData[col];
  if (tile !== undefined) return tile;
  // Extend right side using the last authored column as a repeating default.
  return terrainRepeatFallbackByRow[row] ?? -1;
}

const BASE_MAP_COLS = terrainLayer[0].length;
const WORLD_RIGHT_SCROLL_MULTIPLIER = 1000;
const LOGICAL_MAP_COLS = BASE_MAP_COLS * WORLD_RIGHT_SCROLL_MULTIPLIER;
const mapPixelWidth = LOGICAL_MAP_COLS * TILE_SIZE;
const mapPixelHeight = terrainLayer.length * TILE_SIZE;
industrialBuildings = createInitialIndustrialBuildings();

function getForegroundTileAt(col, row) {
  if (row < 0 || row >= foregroundLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return 0;
  return foregroundLayer[row][col] ?? 0;
}

function isLadderForegroundTile(tileValue) {
  return tileValue === LADDER_TILE_TOP || tileValue === LADDER_TILE_MIDDLE || tileValue === LADDER_TILE_BOTTOM;
}

function getLadderTileAt(col, row) {
  const tileValue = getForegroundTileAt(col, row);
  return isLadderForegroundTile(tileValue) ? tileValue : 0;
}

function getExtraOreKey(col, row) {
  return `${col}:${row}`;
}

function hashCoordsToUnit(seed, col, row, salt) {
  let h = seed ^ Math.imul(col, 374761393) ^ Math.imul(row, 668265263) ^ Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function getProceduralOreAt(col, row) {
  if (!isOreHostTerrainTile(getTerrainTileAt(col, row))) return 0;
  if (getForegroundTileAt(col, row) !== 0) return 0;

  const maxDepthRow = terrainLayer.length - 1;

  const diamondMinDepth = Math.min(maxDepthRow, 26);
  if (row >= diamondMinDepth) {
    const depthT = (row - diamondMinDepth) / Math.max(1, (maxDepthRow - diamondMinDepth));
    const baseChance = 0.01 + (depthT * 0.045);
    if (hashCoordsToUnit(WORLD_SEED_HASH, col, row, 101) <= baseChance) return 1;
  }

  const ironMinDepth = Math.min(maxDepthRow, 15);
  if (row >= ironMinDepth) {
    const depthT = (row - ironMinDepth) / Math.max(1, (maxDepthRow - ironMinDepth));
    const baseChance = 0.04 + (depthT * 0.035);
    if (hashCoordsToUnit(WORLD_SEED_HASH, col, row, 102) <= baseChance) return 2;
  }

  const goldMinDepth = Math.min(maxDepthRow, 20);
  if (row >= goldMinDepth) {
    const depthT = (row - goldMinDepth) / Math.max(1, (maxDepthRow - goldMinDepth));
    const baseChance = 0.02 + (depthT * 0.03);
    if (hashCoordsToUnit(WORLD_SEED_HASH, col, row, 103) <= baseChance) return 3;
  }

  return 0;
}

function getOreTileAt(col, row) {
  if (row < 0 || row >= oreLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return 0;
  if (col < BASE_MAP_COLS) return oreLayer[row][col] ?? 0;
  const extraKey = getExtraOreKey(col, row);
  if (extraOreCleared.has(extraKey)) return 0;
  return getProceduralOreAt(col, row);
}

function clearOreAt(col, row) {
  if (row < 0 || row >= oreLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return;
  if (col < BASE_MAP_COLS) {
    oreLayer[row][col] = 0;
    return;
  }
  extraOreCleared.add(getExtraOreKey(col, row));
}

function getMinedBackdropTileAt(col, row) {
  if (row < 0 || row >= minedBackdropLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return -1;
  return minedBackdropLayer[row][col] ?? -1;
}

function isOreHostTerrainTile(tileIndex) {
  if (tileIndex < 0) return false;
  // Allow ores in natural underground terrain across biomes, not just base dirt.
  if (tileIndex === 11) return true; // dirt
  if (tileIndex === STONE_TILE_INDEX) return true; // stone.png terrain
  if (tileIndex === 1) return false; // grass surface tile
  return true;
}

applyStoneLayerToDeepTerrain();
const terrainRepeatFallbackByRow = terrainLayer.map((row) => row[BASE_MAP_COLS - 1] ?? -1);

function generateDiamondOresFromSeed(seedString) {
  const rand = createSeededRandom(seedString);
  const minDepthRow = Math.min(terrainLayer.length - 1, 26);

  for (let row = minDepthRow; row < terrainLayer.length; row++) {
    const depthT = (row - minDepthRow) / Math.max(1, (terrainLayer.length - 1 - minDepthRow));
    const baseChance = 0.01 + (depthT * 0.045);

    for (let col = 1; col < terrainLayer[0].length - 1; col++) {
      if (!isOreHostTerrainTile(terrainLayer[row][col])) continue;
      if (foregroundLayer[row][col] !== 0) continue;
      if (oreLayer[row][col] !== 0) continue;
      if (rand() > baseChance) continue;

      const clusterSize = rand() < (0.18 + depthT * 0.22) ? (rand() < 0.45 ? 3 : 2) : 1;
      const cells = [[col, row]];
      if (clusterSize >= 2) cells.push([col + (rand() < 0.5 ? -1 : 1), row + (rand() < 0.5 ? 0 : 1)]);
      if (clusterSize >= 3) cells.push([col, row + 1]);

      for (const [cx, cy] of cells) {
        if (cx < 0 || cx >= terrainLayer[0].length || cy < minDepthRow || cy >= terrainLayer.length) continue;
        if (!isOreHostTerrainTile(terrainLayer[cy][cx])) continue;
        if (foregroundLayer[cy][cx] !== 0) continue;
        oreLayer[cy][cx] = 1;
      }
    }
  }
}

generateDiamondOresFromSeed(WORLD_SEED);

function generateIronOresFromSeed(seedString) {
  const rand = createSeededRandom(`${seedString}:iron`);
  const minDepthRow = Math.min(terrainLayer.length - 1, 15);
  const maxDepthRow = terrainLayer.length - 1;

  for (let row = minDepthRow; row <= maxDepthRow; row++) {
    const depthT = (row - minDepthRow) / Math.max(1, (maxDepthRow - minDepthRow));
    const baseChance = 0.04 + (depthT * 0.035);

    for (let col = 1; col < terrainLayer[0].length - 1; col++) {
      if (!isOreHostTerrainTile(terrainLayer[row][col])) continue;
      if (foregroundLayer[row][col] !== 0) continue;
      if (oreLayer[row][col] !== 0) continue;
      if (rand() > baseChance) continue;

      const clusterSize = rand() < (0.35 + depthT * 0.2) ? (rand() < 0.35 ? 4 : 3) : 2;
      const cells = [
        [col, row],
        [col + (rand() < 0.5 ? -1 : 1), row],
      ];
      if (clusterSize >= 3) cells.push([col, row + (rand() < 0.6 ? 1 : -1)]);
      if (clusterSize >= 4) cells.push([col + (rand() < 0.5 ? -1 : 1), row + 1]);

      for (const [cx, cy] of cells) {
        if (cx < 0 || cx >= terrainLayer[0].length || cy < minDepthRow || cy >= terrainLayer.length) continue;
        if (!isOreHostTerrainTile(terrainLayer[cy][cx])) continue;
        if (foregroundLayer[cy][cx] !== 0) continue;
        if (oreLayer[cy][cx] !== 0) continue;
        oreLayer[cy][cx] = 2;
      }
    }
  }
}

generateIronOresFromSeed(WORLD_SEED);

function generateGoldOresFromSeed(seedString) {
  const rand = createSeededRandom(`${seedString}:gold`);
  const minDepthRow = Math.min(terrainLayer.length - 1, 20);
  const maxDepthRow = terrainLayer.length - 1;

  for (let row = minDepthRow; row <= maxDepthRow; row++) {
    const depthT = (row - minDepthRow) / Math.max(1, (maxDepthRow - minDepthRow));
    const baseChance = 0.02 + (depthT * 0.03);

    for (let col = 1; col < terrainLayer[0].length - 1; col++) {
      if (!isOreHostTerrainTile(terrainLayer[row][col])) continue;
      if (foregroundLayer[row][col] !== 0) continue;
      if (oreLayer[row][col] !== 0) continue;
      if (rand() > baseChance) continue;

      const clusterSize = rand() < (0.28 + depthT * 0.18) ? (rand() < 0.45 ? 3 : 2) : 1;
      const cells = [[col, row]];
      if (clusterSize >= 2) cells.push([col + (rand() < 0.5 ? -1 : 1), row]);
      if (clusterSize >= 3) cells.push([col, row + (rand() < 0.6 ? 1 : -1)]);

      for (const [cx, cy] of cells) {
        if (cx < 0 || cx >= terrainLayer[0].length || cy < minDepthRow || cy >= terrainLayer.length) continue;
        if (!isOreHostTerrainTile(terrainLayer[cy][cx])) continue;
        if (foregroundLayer[cy][cx] !== 0) continue;
        if (oreLayer[cy][cx] !== 0) continue;
        oreLayer[cy][cx] = 3;
      }
    }
  }
}

generateGoldOresFromSeed(WORLD_SEED);

function applyStoneLayerToDeepTerrain() {
  const stoneStartRow = Math.min(
    terrainLayer.length - 1,
    EXTRA_TOP_AIR_ROWS + MAP_ROWS + 12
  );

  for (let row = stoneStartRow; row < terrainLayer.length; row++) {
    for (let col = 0; col < terrainLayer[0].length; col++) {
      if (terrainLayer[row][col] !== 11) continue;
      terrainLayer[row][col] = STONE_TILE_INDEX;
    }
  }
}

function setHudToast(message, duration = 0.9) {
  hudToastText = message;
  hudToastTimer = duration;
}

function getBackpackCapacity(itemKey) {
  return playerInventory.backpackCapacity[itemKey] ?? 25;
}

function formatBackpackCountText(itemKey, count) {
  if (itemKey === 'hands') return 'Ready';
  if (itemKey === 'pickaxe') return `${count}/1`;
  return `${count}`;
}

function getBackpackTotals() {
  const itemKeys = Object.keys(playerInventory.backpackCapacity);
  let used = 0;
  let capacity = 0;
  for (const itemKey of itemKeys) {
    used += playerInventory.backpack[itemKey] ?? 0;
    capacity += playerInventory.backpackCapacity[itemKey] ?? 0;
  }
  return {
    used,
    capacity,
    free: Math.max(0, capacity - used)
  };
}

function addToBackpack(itemKey, amount = 1) {
  if (!(itemKey in playerInventory.backpack)) {
    playerInventory.backpack[itemKey] = 0;
  }
  const current = playerInventory.backpack[itemKey];
  playerInventory.backpack[itemKey] = current + amount;
  if (typeof syncHotbarToBackpackTopItems === 'function') {
    syncHotbarToBackpackTopItems();
  }
  return true;
}

function removeFromBackpack(itemKey, amount = 1) {
  if (!(itemKey in playerInventory.backpack)) return false;
  const current = playerInventory.backpack[itemKey] ?? 0;
  if (current < amount) return false;
  playerInventory.backpack[itemKey] = current - amount;
  if (typeof syncHotbarToBackpackTopItems === 'function') {
    syncHotbarToBackpackTopItems();
  }
  return true;
}

function getBackpackItemForTile(tileIndex) {
  if (tileIndex === 1) return 'grass';
  if (tileIndex === 11) return 'dirt';
  if (tileIndex === STONE_TILE_INDEX) return 'stone';
  if (tileIndex === BARK_TILE_INDEX) return 'bark';
  if (tileIndex >= 0) return 'stone';
  return null;
}

function getPlaceableTileForEquippedItem() {
  if (equippedTool === 'Grass') return { itemKey: 'grass', tileIndex: 1, layerType: 'terrain' };
  if (equippedTool === 'Dirt') return { itemKey: 'dirt', tileIndex: 11, layerType: 'terrain' };
  if (equippedTool === 'Stone') return { itemKey: 'stone', tileIndex: STONE_TILE_INDEX, layerType: 'terrain' };
  if (equippedTool === 'Bark') return { itemKey: 'bark', tileIndex: BARK_TILE_INDEX, layerType: 'terrain' };
  if (equippedTool === 'Willow Seed') return { itemKey: 'willowSeed', tileIndex: 0, layerType: 'seedling' };
  if (equippedTool === 'Ladder') return { itemKey: 'ladder', tileIndex: LADDER_TILE_TOP, layerType: 'ladder' };
  if (equippedTool === 'Pointer') return { itemKey: 'pointer', tileIndex: POINTER_TILE_RIGHT, layerType: 'foreground' };
  return null;
}

function canMineTileFromAbove(col, row) {
  // A block is mineable if any face is exposed to empty space.
  return (
    getTerrainTileAt(col, row - 1) < 0 ||
    getTerrainTileAt(col - 1, row) < 0 ||
    getTerrainTileAt(col + 1, row) < 0 ||
    getTerrainTileAt(col, row + 1) < 0
  );
}

function hasMineableBlockAt(col, row) {
  return getOreTileAt(col, row) > 0 || getTerrainTileAt(col, row) >= 0;
}

function isTileInFrontOfPlayer(col) {
  const playerCenterCol = (playerX + (frameWidth / 2)) / TILE_SIZE;
  if (playerDirection === 'Right') return col >= Math.floor(playerCenterCol);
  return col <= Math.floor(playerCenterCol);
}

function hasHorizontalClearSightToTile(col, row) {
  const playerCenterCol = Math.floor((playerX + (frameWidth / 2)) / TILE_SIZE);
  const step = Math.sign(col - playerCenterCol);
  if (step === 0) return true;

  for (let c = playerCenterCol + step; c !== col; c += step) {
    if (hasMineableBlockAt(c, row)) {
      return false;
    }
  }
  return true;
}

function canMineTargetFromPlayer(col, row) {
  if (!isTileInFrontOfPlayer(col)) {
    return { ok: false, reason: 'Face the block' };
  }
  if (!hasHorizontalClearSightToTile(col, row)) {
    return { ok: false, reason: 'Mine front block first' };
  }
  return { ok: true, reason: '' };
}

function facePlayerTowardTile(col) {
  const playerCenterX = playerX + (frameWidth / 2);
  const tileCenterX = (col * TILE_SIZE) + (TILE_SIZE / 2);
  if (tileCenterX > playerCenterX + 1) {
    playerDirection = 'Right';
  } else if (tileCenterX < playerCenterX - 1) {
    playerDirection = 'Left';
  }
}

function playerOverlapsTile(col, row) {
  const tileLeft = col * TILE_SIZE;
  const tileTop = row * TILE_SIZE;
  const tileRight = tileLeft + TILE_SIZE;
  const tileBottom = tileTop + TILE_SIZE;

  const playerLeft = playerX + 1;
  const playerTop = playerY + 2;
  const playerRight = playerX + frameWidth - 1;
  const playerBottom = playerY + frameHeight - 2;

  return (
    playerLeft < tileRight &&
    playerRight > tileLeft &&
    playerTop < tileBottom &&
    playerBottom > tileTop
  );
}

function hasSolidNeighbor(col, row) {
  const upForeground = getForegroundTileAt(col, row - 1);
  const leftForeground = getForegroundTileAt(col - 1, row);
  const rightForeground = getForegroundTileAt(col + 1, row);
  const downForeground = getForegroundTileAt(col, row + 1);
  return (
    getTerrainTileAt(col, row - 1) >= 0 ||
    getTerrainTileAt(col - 1, row) >= 0 ||
    getTerrainTileAt(col + 1, row) >= 0 ||
    getTerrainTileAt(col, row + 1) >= 0 ||
    isLadderForegroundTile(upForeground) ||
    isLadderForegroundTile(leftForeground) ||
    isLadderForegroundTile(rightForeground) ||
    isLadderForegroundTile(downForeground)
  );
}

function canPlantWillowSeedAt(col, row) {
  if (row < 0 || row >= terrainLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) {
    return { ok: false, reason: 'Out of bounds' };
  }
  const terrainTile = getTerrainTileAt(col, row);
  if (terrainTile !== 1 && terrainTile !== 11) {
    return { ok: false, reason: 'Plant on dirt/grass' };
  }
  if (getOreTileAt(col, row) > 0) {
    return { ok: false, reason: 'Clear ore first' };
  }
  if (getForegroundTileAt(col, row) > 0) {
    return { ok: false, reason: 'Foreground occupied' };
  }
  if (row <= 0) {
    return { ok: false, reason: 'Needs open space' };
  }
  if (getTerrainTileAt(col, row - 1) >= 0 || getOreTileAt(col, row - 1) > 0) {
    return { ok: false, reason: 'Needs open space' };
  }
  const foregroundAbove = getForegroundTileAt(col, row - 1);
  if (foregroundAbove > 0 && !isLadderForegroundTile(foregroundAbove)) {
    return { ok: false, reason: 'Space blocked' };
  }
  if (getWillowSeedlingAt(col, row)) {
    return { ok: false, reason: 'Seed already planted' };
  }
  if (getActiveWillowTreeAt(col, row)) {
    return { ok: false, reason: 'Tree already here' };
  }
  return { ok: true, reason: '' };
}

function canPlaceTileAt(col, row, placeable = null) {
  if (row < 0 || row >= terrainLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) {
    return { ok: false, reason: 'Out of bounds' };
  }
  const placeLayerType = placeable?.layerType ?? 'terrain';
  if (placeLayerType === 'seedling') {
    return canPlantWillowSeedAt(col, row);
  }
  if (getTerrainTileAt(col, row) >= 0 || getOreTileAt(col, row) > 0) {
    return { ok: false, reason: 'Occupied' };
  }
  const foregroundTile = getForegroundTileAt(col, row);
  if (placeLayerType === 'ladder' || placeLayerType === 'foreground') {
    if (foregroundTile > 0) {
      return { ok: false, reason: 'Foreground occupied' };
    }
  } else if (foregroundTile > 0 && !isLadderForegroundTile(foregroundTile)) {
    return { ok: false, reason: 'Blocked by foreground' };
  }

  if (!hasSolidNeighbor(col, row)) {
    return { ok: false, reason: 'Needs support' };
  }
  if (playerOverlapsTile(col, row)) {
    return { ok: false, reason: 'Too close' };
  }
  return { ok: true, reason: '' };
}

function plantWillowSeedAt(col, row) {
  const placedAt = Date.now();
  const growDuration = WILLOW_GROW_MIN_MS + Math.floor(Math.random() * (WILLOW_GROW_MAX_MS - WILLOW_GROW_MIN_MS + 1));
  willowSeedlings.push({
    id: nextWillowEntityId('seedling'),
    col,
    row,
    plantedAtMs: placedAt,
    growAtMs: placedAt + growDuration,
    variant: 1 + Math.floor(Math.random() * 3)
  });
}

function refreshLadderTileAt(col, row) {
  const current = getForegroundTileAt(col, row);
  if (!isLadderForegroundTile(current)) return;
  const hasLadderAbove = isLadderForegroundTile(getForegroundTileAt(col, row - 1));
  const hasLadderBelow = isLadderForegroundTile(getForegroundTileAt(col, row + 1));
  if (hasLadderAbove && hasLadderBelow) {
    foregroundLayer[row][col] = LADDER_TILE_MIDDLE;
  } else if (hasLadderAbove && !hasLadderBelow) {
    foregroundLayer[row][col] = LADDER_TILE_BOTTOM;
  } else {
    foregroundLayer[row][col] = LADDER_TILE_TOP;
  }
}

function refreshAdjacentLadderTiles(col, row) {
  refreshLadderTileAt(col, row - 1);
  refreshLadderTileAt(col, row);
  refreshLadderTileAt(col, row + 1);
}

function removeWillowSeedlingAt(col, row) {
  const idx = willowSeedlings.findIndex((seedling) => seedling && seedling.col === col && seedling.row === row);
  if (idx < 0) return false;
  willowSeedlings.splice(idx, 1);
  return true;
}

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = (abx * abx) + (aby * aby);
  if (abLenSq <= 0.0001) return Math.hypot(px - ax, py - ay);
  const apx = px - ax;
  const apy = py - ay;
  const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / abLenSq));
  const cx = ax + (abx * t);
  const cy = ay + (aby * t);
  return Math.hypot(px - cx, py - cy);
}

function getLaserHeatTileKey(col, row) {
  return `${col}:${row}`;
}

function lerpHexColor(a, b, t) {
  const p = Math.max(0, Math.min(1, t));
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const rr = Math.round(ar + ((br - ar) * p));
  const rg = Math.round(ag + ((bg - ag) * p));
  const rb = Math.round(ab + ((bb - ab) * p));
  return `#${rr.toString(16).padStart(2, '0')}${rg.toString(16).padStart(2, '0')}${rb.toString(16).padStart(2, '0')}`;
}

function getRuneHandWorldPos() {
  const handOffsetX = playerDirection === 'Left' ? (PICKAXE_HAND_OFFSET_LEFT_X + 1) : (PICKAXE_HAND_OFFSET_RIGHT_X - 2);
  const handOffsetY = playerDirection === 'Left' ? (PICKAXE_HAND_OFFSET_LEFT_Y + 2) : (PICKAXE_HAND_OFFSET_RIGHT_Y + 2);
  const breathPhase = cameraBreathTime * CAMERA_BREATH_SPEED;
  const isBreathingPose = !climbing && onGround && Math.abs(velocityY) < 1;
  const handBreathX = isBreathingPose ? Math.sin(breathPhase * 0.9) * 0.35 : 0;
  const handBreathY = isBreathingPose ? Math.cos(breathPhase * 1.1) * 0.65 : 0;
  return {
    x: playerX + handOffsetX + handBreathX + (TILE_SIZE * 0.18),
    y: playerY + handOffsetY + handBreathY + (TILE_SIZE * 0.12)
  };
}

function getLaserRuneDeployProgress() {
  const durationMs = 320;
  const t = (performance.now() - laserRuneDeployStartTime) / durationMs;
  return Math.max(0, Math.min(1, t));
}

function easeOutBack01(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = Math.max(0, Math.min(1, t));
  return 1 + (c3 * Math.pow(p - 1, 3)) + (c1 * Math.pow(p - 1, 2));
}

function getLaserRuneFloatWorldPos() {
  if (laserRuneShotTimer > 0 && laserRuneShotOriginLocked) {
    return { x: laserRuneShotOriginWorldX, y: laserRuneShotOriginWorldY };
  }
  const hand = getRuneHandWorldPos();
  const hoverPhase = (performance.now() / 160) + (playerX * 0.01);
  const targetX = playerX + (frameWidth * 0.5) + Math.sin(hoverPhase * 0.55) * 2.2;
  const targetY = playerY - 22 + Math.sin(hoverPhase) * 2.6;
  const deployT = easeOutBack01(getLaserRuneDeployProgress());
  return {
    x: hand.x + ((targetX - hand.x) * deployT),
    y: hand.y + ((targetY - hand.y) * deployT)
  };
}

function getLaserRuneBeamState() {
  const stacks = getLaserRuneStacks();
  if (stacks <= 0 || craftingMenuOpen || laserRuneShotTimer <= 0) {
    return { active: false, stacks: 0, ax: 0, ay: 0, bx: 0, by: 0, radius: 0 };
  }
  const hand = getLaserRuneFloatWorldPos();
  const radius = 10 + (stacks * 4);
  return {
    active: true,
    stacks,
    ax: hand.x,
    ay: hand.y,
    bx: laserRuneTargetWorldX,
    by: laserRuneTargetWorldY,
    radius
  };
}

function getLaserRuneCooldownVisualHeat() {
  if (laserRuneShotTimer > 0) return 1;
  if (laserRuneShotCooldownTimer <= 0) return 0;
  return Math.max(0, Math.min(1, laserRuneShotCooldownTimer / LASER_RUNE_SHOT_COOLDOWN_SECONDS));
}

function vaporizeWillowTreesNearBeam(ax, ay, bx, by, radius) {
  let changed = false;
  for (const tree of willowTrees) {
    if (!tree || tree.cut) continue;
    const rect = getWillowTreeDrawRect(tree);
    const sampleX = rect.x + (rect.w * 0.5);
    const sampleY = rect.y + (rect.h * 0.55);
    if (distancePointToSegment(sampleX, sampleY, ax, ay, bx, by) <= radius + 10) {
      tree.cut = true;
      changed = true;
    }
  }
  return changed;
}

function vaporizeTileAt(col, row) {
  if (row < 0 || row >= terrainLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return false;
  const foregroundTile = getForegroundTileAt(col, row);
  if (foregroundTile > 0) {
    foregroundLayer[row][col] = 0;
    if (isLadderForegroundTile(foregroundTile)) {
      refreshAdjacentLadderTiles(col, row);
    }
    return true;
  }

  const oreTile = getOreTileAt(col, row);
  const terrainTile = getTerrainTileAt(col, row);
  if (oreTile > 0 || terrainTile >= 0) {
    if (terrainTile >= 0) {
      minedBackdropLayer[row][col] = terrainTile;
      terrainLayer[row][col] = -1;
    }
    if (oreTile > 0) {
      clearOreAt(col, row);
    }
    removeWillowSeedlingAt(col, row);
    return true;
  }

  return false;
}

function applyLaserRuneBeamTick() {
  const beam = getLaserRuneBeamState();
  if (!beam.active) return false;

  const minX = Math.min(beam.ax, beam.bx) - beam.radius;
  const maxX = Math.max(beam.ax, beam.bx) + beam.radius;
  const minY = Math.min(beam.ay, beam.by) - beam.radius;
  const maxY = Math.max(beam.ay, beam.by) + beam.radius;
  const startCol = Math.max(0, Math.floor(minX / TILE_SIZE));
  const endCol = Math.min(LOGICAL_MAP_COLS - 1, Math.floor(maxX / TILE_SIZE));
  const startRow = Math.max(0, Math.floor(minY / TILE_SIZE));
  const endRow = Math.min(terrainLayer.length - 1, Math.floor(maxY / TILE_SIZE));

  const abx = beam.bx - beam.ax;
  const aby = beam.by - beam.ay;
  const abLen = Math.hypot(abx, aby);
  if (abLen < 0.001) return false;
  const ux = abx / abLen;
  const uy = aby / abLen;

  let best = null;
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const centerX = (col * TILE_SIZE) + (TILE_SIZE * 0.5);
      const centerY = (row * TILE_SIZE) + (TILE_SIZE * 0.5);
      if (distancePointToSegment(centerX, centerY, beam.ax, beam.ay, beam.bx, beam.by) > beam.radius) continue;
      const hasForeground = getForegroundTileAt(col, row) > 0;
      const hasTerrain = getTerrainTileAt(col, row) >= 0 || getOreTileAt(col, row) > 0;
      if (!hasForeground && !hasTerrain) continue;

      const along = ((centerX - beam.ax) * ux) + ((centerY - beam.ay) * uy);
      if (along < 0 || along > abLen + beam.radius) continue;
      const frontPriority = hasForeground ? 0 : 1; // foreground is "front" of terrain

      if (
        !best ||
        along < best.along - 0.0001 ||
        (Math.abs(along - best.along) <= 0.0001 && frontPriority < best.frontPriority)
      ) {
        best = { col, row, along, frontPriority };
      }
    }
  }

  if (!best) return false;

  const changed = vaporizeTileAt(best.col, best.row);
  if (changed) {
    markGameStateDirty();
  }
  return changed;
}

function updateLaserBeamHeat(dt) {
  if (dt <= 0) return;

  laserRuneIconHeat = getLaserRuneCooldownVisualHeat();

  const beam = getLaserRuneBeamState();
  if (beam.active) {
    const minX = Math.min(beam.ax, beam.bx) - beam.radius;
    const maxX = Math.max(beam.ax, beam.bx) + beam.radius;
    const minY = Math.min(beam.ay, beam.by) - beam.radius;
    const maxY = Math.max(beam.ay, beam.by) + beam.radius;
    const startCol = Math.max(0, Math.floor(minX / TILE_SIZE));
    const endCol = Math.min(LOGICAL_MAP_COLS - 1, Math.floor(maxX / TILE_SIZE));
    const startRow = Math.max(0, Math.floor(minY / TILE_SIZE));
    const endRow = Math.min(terrainLayer.length - 1, Math.floor(maxY / TILE_SIZE));

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const hasForeground = getForegroundTileAt(col, row) > 0;
        const hasTerrain = getTerrainTileAt(col, row) >= 0 || getOreTileAt(col, row) > 0;
        if (!hasForeground && !hasTerrain) continue;
        const centerX = (col * TILE_SIZE) + (TILE_SIZE * 0.5);
        const centerY = (row * TILE_SIZE) + (TILE_SIZE * 0.5);
        if (distancePointToSegment(centerX, centerY, beam.ax, beam.ay, beam.bx, beam.by) > beam.radius) continue;
        const key = getLaserHeatTileKey(col, row);
        const current = laserBeamTileHeat.get(key) ?? 0;
        laserBeamTileHeat.set(key, Math.min(1, current + (dt * LASER_BEAM_HEAT_RISE_PER_SEC)));
      }
    }
  }

  if (!laserBeamTileHeat.size) return;
  for (const [key, value] of laserBeamTileHeat.entries()) {
    const next = value - (dt * LASER_BEAM_HEAT_COOL_PER_SEC);
    if (next <= 0.02) {
      laserBeamTileHeat.delete(key);
      continue;
    }
    const split = key.indexOf(':');
    const col = Number(key.slice(0, split));
    const row = Number(key.slice(split + 1));
    const stillHasBlock =
      (getForegroundTileAt(col, row) > 0) ||
      (getTerrainTileAt(col, row) >= 0) ||
      (getOreTileAt(col, row) > 0);
    if (!stillHasBlock) {
      laserBeamTileHeat.delete(key);
      continue;
    }
    laserBeamTileHeat.set(key, next);
  }
}

function drawLaserBeamHeatOverlay() {
  if (!laserBeamTileHeat.size) return;
  const viewWidthWorld = canvas.width / zoom;
  const viewHeightWorld = canvas.height / zoom;
  const startCol = Math.max(0, Math.floor(cameraX / TILE_SIZE));
  const endCol = Math.min(LOGICAL_MAP_COLS, Math.ceil((cameraX + viewWidthWorld) / TILE_SIZE) + 1);
  const startRow = Math.max(0, Math.floor(cameraY / TILE_SIZE));
  const endRow = Math.min(terrainLayer.length, Math.ceil((cameraY + viewHeightWorld) / TILE_SIZE) + 1);

  ctx.save();
  for (const [key, heat] of laserBeamTileHeat.entries()) {
    if (heat <= 0) continue;
    const split = key.indexOf(':');
    const col = Number(key.slice(0, split));
    const row = Number(key.slice(split + 1));
    if (col < startCol || col >= endCol || row < startRow || row >= endRow) continue;

    const x = Math.round((col * TILE_SIZE - cameraX) * zoom);
    const y = Math.round((row * TILE_SIZE - cameraY) * zoom);
    const s = TILE_SIZE * zoom;
    const alpha = Math.min(0.6, 0.08 + (heat * 0.5));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = lerpHexColor('#ff7a45', '#ff2121', heat);
    ctx.fillRect(x, y, s, s);

    ctx.globalAlpha = Math.min(0.7, 0.14 + (heat * 0.45));
    ctx.strokeStyle = '#ffd2c2';
    ctx.lineWidth = Math.max(1, Math.round(1 * zoom));
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }
  ctx.restore();
}

function tryMineTile(col, row) {
  if (row < 0 || row >= terrainLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return false;
  const hasTargetBlock = hasMineableBlockAt(col, row);
  if (!hasTargetBlock) return false;

  const targetCheck = canMineTargetFromPlayer(col, row);
  if (!targetCheck.ok) {
    setHudToast(targetCheck.reason);
    return false;
  }

  if (!canMineTileFromAbove(col, row)) {
    setHudToast('Expose a side first');
    return false;
  }

  const oreTile = getOreTileAt(col, row);
  const terrainTileBeforeMine = getTerrainTileAt(col, row);
  if (oreTile === 1) {
    const collected = addToBackpack('diamond', 1);
    clearOreAt(col, row);
    if (terrainTileBeforeMine >= 0) minedBackdropLayer[row][col] = terrainTileBeforeMine;
    terrainLayer[row][col] = -1;
    markGameStateDirty();
    setHudToast(collected ? '+1 diamond' : 'diamond full (not collected)');
    return true;
  }
  if (oreTile === 2) {
    const collected = addToBackpack('iron', 1);
    clearOreAt(col, row);
    if (terrainTileBeforeMine >= 0) minedBackdropLayer[row][col] = terrainTileBeforeMine;
    terrainLayer[row][col] = -1;
    markGameStateDirty();
    setHudToast(collected ? '+1 iron' : 'iron full (not collected)');
    return true;
  }
  if (oreTile === 3) {
    const collected = addToBackpack('gold', 1);
    clearOreAt(col, row);
    if (terrainTileBeforeMine >= 0) minedBackdropLayer[row][col] = terrainTileBeforeMine;
    terrainLayer[row][col] = -1;
    markGameStateDirty();
    setHudToast(collected ? '+1 gold' : 'gold full (not collected)');
    return true;
  }

  const tileIndex = getTerrainTileAt(col, row);
  if (tileIndex < 0) return false;

  const itemKey = getBackpackItemForTile(tileIndex);
  if (!itemKey) {
    setHudToast('Need better tool');
    return false;
  }

  const collected = addToBackpack(itemKey, 1);

  removeWillowSeedlingAt(col, row);
  minedBackdropLayer[row][col] = tileIndex;
  terrainLayer[row][col] = -1;
  markGameStateDirty();
  setHudToast(collected ? `+1 ${itemKey}` : `${itemKey} full (not collected)`);
  return true;
}

function tryMineWithPickaxe() {
  if (!playerInventory.pickaxe) return false;
  const hoveredTile = getHoveredTile();
  if (!hoveredTile) {
    setHudToast('No block selected');
    return false;
  }
  facePlayerTowardTile(hoveredTile.col);
  return tryMineTile(hoveredTile.col, hoveredTile.row);
}

function tryPlaceEquippedBlock() {
  const placeable = getPlaceableTileForEquippedItem();
  if (!placeable) {
    setHudToast('Select a block slot');
    return false;
  }

  const hoveredTile = getHoveredTile();
  if (!hoveredTile) {
    setHudToast('No tile selected');
    return false;
  }

  const placeCheck = canPlaceTileAt(hoveredTile.col, hoveredTile.row, placeable);
  if (!placeCheck.ok) {
    if (placeCheck.reason && placeCheck.reason !== 'Occupied') {
      setHudToast(placeCheck.reason);
    }
    return false;
  }

  if (!removeFromBackpack(placeable.itemKey, 1)) {
    setHudToast(`No ${placeable.itemKey}`);
    return false;
  }

  if (placeable.layerType === 'seedling') {
    plantWillowSeedAt(hoveredTile.col, hoveredTile.row);
  } else if (placeable.layerType === 'ladder') {
    foregroundLayer[hoveredTile.row][hoveredTile.col] = LADDER_TILE_TOP;
    refreshAdjacentLadderTiles(hoveredTile.col, hoveredTile.row);
  } else if (placeable.layerType === 'foreground') {
    const pointerTile = playerDirection === 'Left' ? POINTER_TILE_LEFT : POINTER_TILE_RIGHT;
    foregroundLayer[hoveredTile.row][hoveredTile.col] = pointerTile;
  } else {
    terrainLayer[hoveredTile.row][hoveredTile.col] = placeable.tileIndex;
  }
  markGameStateDirty();
  setHudToast(`Placed ${placeable.itemKey}`);
  return true;
}

function getHoveredTile() {
  if (mouseCanvasX === null || mouseCanvasY === null) return null;

  const worldX = cameraX + (mouseCanvasX / zoom);
  const worldY = cameraY + (mouseCanvasY / zoom);
  const col = Math.floor(worldX / TILE_SIZE);
  const row = Math.floor(worldY / TILE_SIZE);

  if (row < 0 || row >= terrainLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return null;

  return {
    col,
    row,
    terrainTile: getTerrainTileAt(col, row),
    oreTile: getOreTileAt(col, row)
  };
}

function drawHoveredTileOutline() {
  if (equippedTool === 'Levitation Rune' || equippedTool === 'Laser Rune') return;
  const hoveredTile = getHoveredTile();
  if (!hoveredTile) return;

  const x = Math.round((hoveredTile.col * TILE_SIZE - cameraX) * zoom);
  const y = Math.round((hoveredTile.row * TILE_SIZE - cameraY) * zoom);
  const size = TILE_SIZE * zoom;
  const placeable = getPlaceableTileForEquippedItem();
  let canHighlight = false;
  let goodAction = false;
  let fillColor = '#5ee9ff';
  let strokeColor = '#9ff3ff';

  if (placeable) {
    const placeCheck = canPlaceTileAt(hoveredTile.col, hoveredTile.row, placeable);
    canHighlight = true;
    goodAction = placeCheck.ok;
    fillColor = goodAction ? '#a6ff80' : '#ff5f76';
    strokeColor = goodAction ? '#d7ffb8' : '#ff8f9f';
  } else {
    const hasTargetBlock = hasMineableBlockAt(hoveredTile.col, hoveredTile.row);
    const frontCheck = canMineTargetFromPlayer(hoveredTile.col, hoveredTile.row);
    goodAction = hasTargetBlock && frontCheck.ok && canMineTileFromAbove(hoveredTile.col, hoveredTile.row);
    canHighlight = true;
  }

  if (!canHighlight) return;

  ctx.save();
  ctx.lineWidth = Math.max(1, Math.round(2 * zoom));
  ctx.strokeStyle = goodAction ? strokeColor : '#ff8f9f';
  ctx.globalAlpha = goodAction ? 0.95 : 0.65;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = goodAction ? fillColor : '#ff5f76';
  ctx.fillRect(x, y, size, size);
  ctx.restore();
}

function getLadderInfoAtPlayerRect(x = playerX, y = playerY) {
  const sampleXs = [
    x + frameWidth * 0.35,
    x + frameWidth * 0.5,
    x + frameWidth * 0.65
  ];
  const sampleYs = [
    y + 4,
    y + frameHeight * 0.5,
    y + frameHeight - 4
  ];

  for (const sampleX of sampleXs) {
    const col = Math.floor(sampleX / TILE_SIZE);
    for (const sampleY of sampleYs) {
      const row = Math.floor(sampleY / TILE_SIZE);
      const tileValue = getForegroundTileAt(col, row);
      if (isLadderForegroundTile(tileValue)) {
        return { col, row, tileValue };
      }
    }
  }

  return null;
}

function isSolidTileAt(col, row) {
  if (row < 0 || row >= terrainLayer.length || col < 0 || col >= LOGICAL_MAP_COLS) return false;
  return getTerrainTileAt(col, row) >= 0;
}

function collidesAtPlayerRect(x, y) {
  const left = x;
  const right = x + frameWidth - 1;
  const top = y + 2;
  const bottom = y + frameHeight - 2;

  const leftCol = Math.floor(left / TILE_SIZE);
  const rightCol = Math.floor(right / TILE_SIZE);
  const topRow = Math.floor(top / TILE_SIZE);
  const bottomRow = Math.floor(bottom / TILE_SIZE);

  return (
    isSolidTileAt(leftCol, topRow) ||
    isSolidTileAt(rightCol, topRow) ||
    isSolidTileAt(leftCol, bottomRow) ||
    isSolidTileAt(rightCol, bottomRow)
  );
}

function movePlayerX(deltaX) {
  if (deltaX === 0) return;

  const startX = playerX;
  let nextX = playerX + deltaX;
  nextX = Math.max(0, Math.min(nextX, mapPixelWidth - frameWidth));

  if (!collidesAtPlayerRect(nextX, playerY)) {
    playerX = nextX;
    return;
  }

  const step = Math.sign(deltaX);
  while (Math.abs((playerX + step) - startX) <= Math.abs(deltaX)) {
    const candidate = playerX + step;
    if (candidate < 0 || candidate > mapPixelWidth - frameWidth) break;
    if (collidesAtPlayerRect(candidate, playerY)) break;
    playerX = candidate;
  }
}

function movePlayerY(deltaY) {
  if (deltaY === 0) {
    return { hitTop: false, hitBottom: false };
  }

  const startY = playerY;
  const worldBottomY = mapPixelHeight - frameHeight;
  let nextY = playerY + deltaY;
  nextY = Math.max(0, Math.min(nextY, worldBottomY));

  if (!collidesAtPlayerRect(playerX, nextY)) {
    playerY = nextY;
    return {
      hitTop: deltaY < 0 && nextY <= 0,
      hitBottom: deltaY > 0 && nextY >= worldBottomY
    };
  }

  // If a sub-pixel move collides, report the hit immediately to avoid
  // ground-state jitter when gravity steps are smaller than 1px.
  if (Math.abs(deltaY) < 1) {
    return { hitTop: deltaY < 0, hitBottom: deltaY > 0 };
  }

  const step = Math.sign(deltaY);
  while (Math.abs((playerY + step) - startY) <= Math.abs(deltaY)) {
    const candidate = playerY + step;
    if (candidate < 0 || candidate > worldBottomY) {
      return { hitTop: step < 0, hitBottom: step > 0 };
    }
    if (collidesAtPlayerRect(playerX, candidate)) {
      return { hitTop: step < 0, hitBottom: step > 0 };
    }
    playerY = candidate;
  }

  return { hitTop: false, hitBottom: false };
}

function groundYAtPlayer() {
  const feetY = playerY + frameHeight;
  const startRow = Math.max(0, Math.floor(feetY / TILE_SIZE));
  const footCols = [
    Math.floor((playerX + 2) / TILE_SIZE),
    Math.floor((playerX + frameWidth - 3) / TILE_SIZE)
  ];

  let bestGroundY = mapPixelHeight - frameHeight;
  for (const col of footCols) {
    let row = startRow;
    while (row < terrainLayer.length && !isSolidTileAt(col, row)) {
      row += 1;
    }
    if (row < terrainLayer.length) {
      bestGroundY = Math.min(bestGroundY, row * TILE_SIZE - frameHeight);
    }
  }

  return bestGroundY;
}

function isStandingOnDirtOrGrass() {
  if (!onGround || climbing) return false;

  const footY = playerY + frameHeight;
  const row = Math.floor(footY / TILE_SIZE);
  const footCols = [
    Math.floor((playerX + 2) / TILE_SIZE),
    Math.floor((playerX + frameWidth - 3) / TILE_SIZE)
  ];

  for (const col of footCols) {
    const tileIndex = getTerrainTileAt(col, row);
    if (tileIndex === 1 || tileIndex === 11) {
      return true;
    }
  }

  return false;
}

function drawTile(tileIndex, worldX, worldY) {
  if (tileIndex < 0) return;

  if (tileIndex === STONE_TILE_INDEX && stoneTileImg) {
    ctx.drawImage(
      stoneTileImg,
      Math.round((worldX - cameraX) * zoom),
      Math.round((worldY - cameraY) * zoom),
      TILE_SIZE * zoom,
      TILE_SIZE * zoom
    );
    return;
  }

  const tilesPerRow = Math.floor(tileSetImg.width / TILE_SIZE);
  const sx = (tileIndex % tilesPerRow) * TILE_SIZE;
  const sy = Math.floor(tileIndex / tilesPerRow) * TILE_SIZE;

  ctx.drawImage(
    tileSetImg,
    sx, sy, TILE_SIZE, TILE_SIZE,
    Math.round((worldX - cameraX) * zoom),
    Math.round((worldY - cameraY) * zoom),
    TILE_SIZE * zoom, TILE_SIZE * zoom
  );
}

function drawMap() {
  const viewWidthWorld = canvas.width / zoom;
  const viewHeightWorld = canvas.height / zoom;
  const startCol = Math.max(0, Math.floor(cameraX / TILE_SIZE));
  const endCol = Math.min(LOGICAL_MAP_COLS, Math.ceil((cameraX + viewWidthWorld) / TILE_SIZE) + 1);
  const startRow = Math.max(0, Math.floor(cameraY / TILE_SIZE));
  const endRow = Math.min(terrainLayer.length, Math.ceil((cameraY + viewHeightWorld) / TILE_SIZE) + 1);

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      drawTile(getTerrainTileAt(col, row), col * TILE_SIZE, row * TILE_SIZE);
    }
  }
}

function drawMinedBackdrops() {
  const viewWidthWorld = canvas.width / zoom;
  const viewHeightWorld = canvas.height / zoom;
  const startCol = Math.max(0, Math.floor(cameraX / TILE_SIZE));
  const endCol = Math.min(LOGICAL_MAP_COLS, Math.ceil((cameraX + viewWidthWorld) / TILE_SIZE) + 1);
  const startRow = Math.max(0, Math.floor(cameraY / TILE_SIZE));
  const endRow = Math.min(minedBackdropLayer.length, Math.ceil((cameraY + viewHeightWorld) / TILE_SIZE) + 1);

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const backdropTile = getMinedBackdropTileAt(col, row);
      if (backdropTile < 0) continue;
      const worldX = col * TILE_SIZE;
      const worldY = row * TILE_SIZE;
      drawTile(backdropTile, worldX, worldY);

      // Darken the mined tile to read as a depleted background wall.
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#000000';
      ctx.fillRect(
        Math.round((worldX - cameraX) * zoom),
        Math.round((worldY - cameraY) * zoom),
        TILE_SIZE * zoom,
        TILE_SIZE * zoom
      );
      ctx.restore();
    }
  }
}

function drawDepthBackgroundFade() {
  const viewHeightWorld = canvas.height / zoom;
  const undergroundCameraStartY = Math.max(0, SURFACE_FLOOR_Y - (viewHeightWorld * 0.5));
  const fadeDistance = Math.max(TILE_SIZE * 2, EXTRA_DIRT_ROWS * TILE_SIZE * 0.85);
  const depthT = Math.max(0, Math.min(1, (cameraY - undergroundCameraStartY) / fadeDistance));
  if (depthT <= 0) return;

  const alpha = depthT * MAX_BACKGROUND_DEPTH_FADE;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawOres() {
  if (!diamondImg && !ironImg && !goldImg) return;

  const viewWidthWorld = canvas.width / zoom;
  const viewHeightWorld = canvas.height / zoom;
  const startCol = Math.max(0, Math.floor(cameraX / TILE_SIZE));
  const endCol = Math.min(LOGICAL_MAP_COLS, Math.ceil((cameraX + viewWidthWorld) / TILE_SIZE) + 1);
  const startRow = Math.max(0, Math.floor(cameraY / TILE_SIZE));
  const endRow = Math.min(oreLayer.length, Math.ceil((cameraY + viewHeightWorld) / TILE_SIZE) + 1);

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const oreTile = getOreTileAt(col, row);
      if (oreTile === 0) continue;
      const oreImage = oreTile === 1 ? diamondImg : (oreTile === 2 ? ironImg : (oreTile === 3 ? goldImg : null));
      if (!oreImage) continue;
      ctx.drawImage(
        oreImage,
        Math.round((col * TILE_SIZE - cameraX) * zoom),
        Math.round((row * TILE_SIZE - cameraY) * zoom),
        TILE_SIZE * zoom,
        TILE_SIZE * zoom
      );
    }
  }
}

function drawForegroundSprite(image, worldX, worldY, drawWidth = TILE_SIZE, drawHeight = TILE_SIZE, anchorBottom = false) {
  if (!image) return;
  const screenX = Math.round((worldX - cameraX) * zoom);
  const screenYBase = Math.round((worldY - cameraY) * zoom);
  const screenW = drawWidth * zoom;
  const screenH = drawHeight * zoom;
  const screenY = anchorBottom ? Math.round(screenYBase + (TILE_SIZE * zoom) - screenH) : screenYBase;
  ctx.drawImage(
    image,
    screenX,
    screenY,
    screenW,
    screenH
  );
}

function drawForeground() {
  const viewWidthWorld = canvas.width / zoom;
  const viewHeightWorld = canvas.height / zoom;
  const startCol = Math.max(0, Math.floor(cameraX / TILE_SIZE));
  const endCol = Math.min(LOGICAL_MAP_COLS, Math.ceil((cameraX + viewWidthWorld) / TILE_SIZE) + 1);
  const startRow = Math.max(0, Math.floor(cameraY / TILE_SIZE));
  const endRow = Math.min(foregroundLayer.length, Math.ceil((cameraY + viewHeightWorld) / TILE_SIZE) + 1);

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const foregroundTile = getForegroundTileAt(col, row);
      if (foregroundTile === 0) continue;

      let foregroundImage = null;
      if (foregroundTile === LADDER_TILE_BOTTOM) foregroundImage = ladderBottomImg;
      if (foregroundTile === LADDER_TILE_MIDDLE) foregroundImage = ladderMiddleImg;
      if (foregroundTile === LADDER_TILE_TOP) foregroundImage = ladderTopImg;

      const bushVariant = FOREGROUND_BUSH_VARIANT_BY_TILE[foregroundTile];
      if (!foregroundImage && bushVariant) {
        foregroundImage = bushForegroundImgs[bushVariant] || null;
      }
      const pointerVariant = FOREGROUND_POINTER_VARIANT_BY_TILE[foregroundTile];
      if (!foregroundImage && pointerVariant) {
        foregroundImage = pointerForegroundImgs[pointerVariant] || null;
      }
      if ((bushVariant || pointerVariant) && foregroundImage) {
        const bushW = foregroundImage.naturalWidth || TILE_SIZE;
        const bushH = foregroundImage.naturalHeight || TILE_SIZE;
        const bushX = (col * TILE_SIZE) + ((TILE_SIZE - bushW) / 2);
        drawForegroundSprite(foregroundImage, bushX, row * TILE_SIZE, bushW, bushH, true);
      } else {
        drawForegroundSprite(foregroundImage, col * TILE_SIZE, row * TILE_SIZE);
      }
    }
  }
}

function drawTileIcon(tileIndex, x, y, size) {
  if (!tileSetImg || tileIndex < 0) return false;
  const tilesPerRow = Math.floor(tileSetImg.width / TILE_SIZE);
  if (!tilesPerRow) return false;
  const sx = (tileIndex % tilesPerRow) * TILE_SIZE;
  const sy = Math.floor(tileIndex / tilesPerRow) * TILE_SIZE;
  ctx.drawImage(tileSetImg, sx, sy, TILE_SIZE, TILE_SIZE, x, y, size, size);
  return true;
}

function getWillowTreeDrawRect(tree) {
  const img = willowTreeImgs[tree.variant];
  const w = (img && img.naturalWidth) ? img.naturalWidth : (TILE_SIZE * 2);
  const h = (img && img.naturalHeight) ? img.naturalHeight : (TILE_SIZE * 3);
  return {
    x: tree.x,
    y: tree.baseY - h,
    w,
    h
  };
}

function getHoveredWillowTree() {
  if (mouseCanvasX === null || mouseCanvasY === null) return null;
  const worldX = cameraX + (mouseCanvasX / zoom);
  const worldY = cameraY + (mouseCanvasY / zoom);
  for (let i = willowTrees.length - 1; i >= 0; i--) {
    const tree = willowTrees[i];
    if (!tree || tree.cut) continue;
    const rect = getWillowTreeDrawRect(tree);
    if (worldX >= rect.x && worldX <= rect.x + rect.w && worldY >= rect.y && worldY <= rect.y + rect.h) {
      return tree;
    }
  }
  return null;
}

function tryCutWillowTree() {
  if (equippedTool !== 'Axe') return false;
  if ((playerInventory.backpack.axe ?? 0) <= 0) return false;
  const tree = getHoveredWillowTree();
  if (!tree || tree.cut) return false;

  tree.cut = true;
  const woodCollected = addToBackpack('wood', WILLOW_WOOD_DROP);
  const seedCollected = addToBackpack('willowSeed', WILLOW_SEED_DROP);
  markGameStateDirty();

  if (woodCollected && seedCollected) {
    setHudToast(`+${WILLOW_WOOD_DROP} wood +${WILLOW_SEED_DROP} willow seeds`);
  } else if (!woodCollected && !seedCollected) {
    setHudToast('Willow cut (drops not collected)');
  } else if (!woodCollected) {
    setHudToast(`+${WILLOW_SEED_DROP} willow seeds, wood full`);
  } else {
    setHudToast(`+${WILLOW_WOOD_DROP} wood, seeds full`);
  }
  return true;
}

function updateWillowSeedlings() {
  if (!willowSeedlings.length) return;
  const now = Date.now();
  let changed = false;

  for (let i = willowSeedlings.length - 1; i >= 0; i--) {
    const seedling = willowSeedlings[i];
    if (!seedling) continue;
    if (seedling.growAtMs > now) continue;

    if (!getActiveWillowTreeAt(seedling.col, seedling.row)) {
      willowTrees.push({
        id: nextWillowEntityId('willow'),
        x: seedling.col * TILE_SIZE,
        baseY: seedling.row * TILE_SIZE,
        variant: [1, 2, 3].includes(seedling.variant) ? seedling.variant : (1 + Math.floor(Math.random() * 3)),
        cut: false
      });
    }
    willowSeedlings.splice(i, 1);
    changed = true;
  }

  if (changed) {
    markGameStateDirty();
  }
}

function drawWillowSeedlings() {
  if (!willowSeedlings.length) return;
  const viewWidthWorld = canvas.width / zoom;
  const viewHeightWorld = canvas.height / zoom;
  const startCol = Math.max(0, Math.floor(cameraX / TILE_SIZE) - 1);
  const endCol = Math.min(LOGICAL_MAP_COLS, Math.ceil((cameraX + viewWidthWorld) / TILE_SIZE) + 1);
  const startRow = Math.max(0, Math.floor(cameraY / TILE_SIZE) - 1);
  const endRow = Math.min(terrainLayer.length, Math.ceil((cameraY + viewHeightWorld) / TILE_SIZE) + 1);

  const now = Date.now();
  for (const seedling of willowSeedlings) {
    if (!seedling) continue;
    if (seedling.col < startCol || seedling.col > endCol || seedling.row < startRow || seedling.row > endRow) continue;

    const tileScreenX = Math.round((seedling.col * TILE_SIZE - cameraX) * zoom);
    const tileScreenY = Math.round((seedling.row * TILE_SIZE - cameraY) * zoom);
    const centerX = tileScreenX + (TILE_SIZE * zoom * 0.5);
    const baseY = tileScreenY + 1;
    const growT = Math.max(0, Math.min(1, ((now - (seedling.plantedAtMs ?? now)) / Math.max(1, (seedling.growAtMs ?? now) - (seedling.plantedAtMs ?? now)))));
    const sproutH = Math.max(3, (3 + Math.floor(growT * 4)) * zoom);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.95;

    ctx.strokeStyle = '#4b8f3c';
    ctx.lineWidth = Math.max(1, 1.25 * zoom);
    ctx.beginPath();
    ctx.moveTo(centerX, baseY);
    ctx.lineTo(centerX, baseY - sproutH);
    ctx.stroke();

    ctx.fillStyle = '#88da74';
    ctx.beginPath();
    ctx.ellipse(centerX - (1.4 * zoom), baseY - (sproutH * 0.55), 1.8 * zoom, 1.1 * zoom, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(centerX + (1.4 * zoom), baseY - (sproutH * 0.75), 1.9 * zoom, 1.15 * zoom, 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#7b5128';
    ctx.fillRect(centerX - Math.max(1, 0.8 * zoom), baseY, Math.max(2, 1.6 * zoom), Math.max(1, 1.2 * zoom));
    ctx.restore();
  }
}

function drawWillowTrees() {
  for (const tree of willowTrees) {
    if (!tree || tree.cut) continue;
    const img = willowTreeImgs[tree.variant];
    if (!img || !img.complete || img.naturalWidth <= 0) continue;
    const rect = getWillowTreeDrawRect(tree);
    ctx.drawImage(
      img,
      Math.round((rect.x - cameraX) * zoom),
      Math.round((rect.y - cameraY) * zoom),
      rect.w * zoom,
      rect.h * zoom
    );
  }
}

function getTintedRuneFrame(frameIndex, size, frameWidth, frameHeight, tintColor, tintAlpha) {
  if (!runeTintCtx) return null;
  const runeSize = Math.max(1, Math.round(size));
  if (runeTintCanvas.width !== runeSize) runeTintCanvas.width = runeSize;
  if (runeTintCanvas.height !== runeSize) runeTintCanvas.height = runeSize;
  runeTintCtx.clearRect(0, 0, runeSize, runeSize);
  runeTintCtx.drawImage(
    runeSpriteImg,
    frameIndex * frameWidth, 0, frameWidth, frameHeight,
    0, 0, runeSize, runeSize
  );
  runeTintCtx.save();
  runeTintCtx.globalCompositeOperation = 'source-atop';
  runeTintCtx.globalAlpha = tintAlpha;
  runeTintCtx.fillStyle = tintColor;
  runeTintCtx.fillRect(0, 0, runeSize, runeSize);
  runeTintCtx.restore();
  return runeTintCanvas;
}

function drawRuneIcon(x, y, size, tintColor = null, tintAlpha = 0.65) {
  if (runeSpriteImg && runeSpriteImg.complete && runeSpriteImg.naturalWidth > 0) {
    const frameCount = 4;
    const frameWidth = Math.floor(runeSpriteImg.naturalWidth / frameCount) || runeSpriteImg.naturalWidth;
    const frameHeight = runeSpriteImg.naturalHeight || frameWidth;
    const frameIndex = Math.floor((performance.now() / 180) % frameCount);
    if (tintColor) {
      const tintedFrame = getTintedRuneFrame(frameIndex, size, frameWidth, frameHeight, tintColor, tintAlpha);
      if (tintedFrame) {
        ctx.drawImage(tintedFrame, x, y, size, size);
      } else {
        ctx.drawImage(
          runeSpriteImg,
          frameIndex * frameWidth, 0, frameWidth, frameHeight,
          x, y, size, size
        );
      }
    } else {
      ctx.drawImage(
        runeSpriteImg,
        frameIndex * frameWidth, 0, frameWidth, frameHeight,
        x, y, size, size
      );
    }
    return true;
  }
  return false;
}

function fitTextToWidth(text, maxWidth) {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '...';
  let out = text;
  while (out.length > 0 && ctx.measureText(out + ellipsis).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out ? (out + ellipsis) : ellipsis;
}

function drawItemIcon(itemKey, x, y, size) {
  if (itemKey === 'ladder') {
    const ladderIcon = ladderMiddleImg || ladderTopImg || ladderBottomImg;
    if (ladderIcon && ladderIcon.complete && ladderIcon.naturalWidth > 0) {
      ctx.drawImage(ladderIcon, x, y, size, size);
      return true;
    }
  }
  if (itemKey === 'pointer') {
    const pointerIcon = pointerForegroundImgs[1] || pointerForegroundImgs[2];
    if (pointerIcon && pointerIcon.complete && pointerIcon.naturalWidth > 0) {
      ctx.drawImage(pointerIcon, x, y, size, size);
      return true;
    }
  }
  if (itemKey === 'wood') {
    ctx.save();
    ctx.fillStyle = '#5b3b22';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#8e633e';
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.fillStyle = '#c89c6f';
    ctx.fillRect(x + Math.max(1, Math.floor(size * 0.15)), y + Math.floor(size * 0.42), Math.floor(size * 0.7), Math.max(2, Math.floor(size * 0.18)));
    ctx.restore();
    return true;
  }
  if (itemKey === 'willowSeed') {
    ctx.save();
    ctx.fillStyle = '#26361e';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#5aa25d';
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.fillStyle = '#9d6a36';
    ctx.beginPath();
    ctx.ellipse(x + size * 0.43, y + size * 0.58, size * 0.14, size * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8de07b';
    ctx.beginPath();
    ctx.ellipse(x + size * 0.62, y + size * 0.38, size * 0.16, size * 0.1, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return true;
  }
  if (itemKey === 'tripleJumpRune') {
    if (drawRuneIcon(x, y, size)) return true;
    ctx.save();
    ctx.fillStyle = '#2f2442';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#b58cff';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.fillStyle = '#efe5ff';
    ctx.font = `${Math.max(7, Math.floor(size * 0.44))}px "Planes ValMore", monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText('3J', x + Math.max(1, Math.floor(size * 0.18)), y + Math.max(1, Math.floor(size * 0.22)));
    ctx.restore();
    return true;
  }
  if (itemKey === 'levitationRune') {
    if (drawRuneIcon(x, y, size, '#ff2a45', 0.72)) return true;
    return false;
  }
  if (itemKey === 'laserRune') {
    if (drawRuneIcon(x, y, size, '#22ff68', 0.78)) return true;
    return false;
  }

  const iconMap = {
    diamond: diamondIconImg,
    iron: ironIconImg,
    gold: goldIconImg
  };
  const fallbackImageMap = {
    pickaxe: pickaxeImg,
    axe: axeImg,
    stone: stoneTileImg,
    bark: barkImg,
    woodPlanks: woodPlanksImg,
    diamond: diamondImg,
    iron: ironImg,
    gold: goldImg
  };
  const fallbackTileMap = {
    grass: 1,
    dirt: 11
  };

  const preferredIcon = iconMap[itemKey];
  if (preferredIcon && preferredIcon.complete && preferredIcon.naturalWidth > 0) {
    ctx.drawImage(preferredIcon, x, y, size, size);
    return true;
  }

  const fallbackImg = fallbackImageMap[itemKey];
  if (fallbackImg && fallbackImg.complete && fallbackImg.naturalWidth > 0) {
    ctx.drawImage(fallbackImg, x, y, size, size);
    return true;
  }

  if (itemKey in fallbackTileMap) {
    return drawTileIcon(fallbackTileMap[itemKey], x, y, size);
  }

  return false;
}

function drawCraftingMenu() {
  const { panelW, panelH, panelX, panelY, rowStartY, rowGap, backpackX, backpackW, backpackViewportY, backpackViewportH } = getCraftingMenuLayout();
  const draggedRowIndex = backpackRowDrag ? backpackRowDrag.rowIndex : -1;
  const { contentHeight: backpackContentHeight, maxScroll: backpackMaxScroll } = getCraftingBackpackScrollMetrics();
  const { contentHeight: recipeListContentHeight, maxScroll: recipeListMaxScroll } = getCraftingRecipeListScrollMetrics();
  clampCraftingBackpackScroll();
  clampCraftingRecipeListScroll();

  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#17131c';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = '#5d6877';
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2);

  ctx.fillStyle = '#111922';
  ctx.fillRect(panelX + 10, panelY + 10, panelW - 20, 28);
  ctx.strokeStyle = '#3e4c5e';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX + 10.5, panelY + 10.5, panelW - 21, 27);

  ctx.textBaseline = 'top';
  ctx.font = '14px "Planes ValMore", monospace';
  ctx.fillStyle = '#dff7ff';
  ctx.fillText('Crafting', panelX + 18, panelY + 16);

  ctx.font = '10px "Planes ValMore", monospace';
  ctx.fillStyle = '#b8c7d8';
  ctx.fillText('Press E to close', panelX + panelW - 104, panelY + 18);

  ctx.font = '11px "Planes ValMore", monospace';
  ctx.fillStyle = '#f0f4ff';
  ctx.fillText('Backpack', panelX + 16, panelY + 44);
  ctx.fillStyle = '#aeb8c6';
  ctx.fillText('Recipes', panelX + Math.floor(panelW * 0.52), panelY + 44);

  ctx.save();
  ctx.beginPath();
  ctx.rect(backpackX, backpackViewportY, backpackW, backpackViewportH);
  ctx.clip();
  for (let i = 0; i < backpackRowOrder.length; i++) {
    const rowKey = backpackRowOrder[i];
    const y = rowStartY + (i * rowGap) - craftingBackpackScroll;
    if (y + 20 < backpackViewportY || y - 2 > backpackViewportY + backpackViewportH) continue;
    const isToolRow = rowKey === 'pickaxe' || rowKey === 'hands';
    const count = rowKey === 'pickaxe' ? (playerInventory.pickaxe ?? 0) : (playerInventory.backpack[rowKey] ?? 0);
    const cap = rowKey === 'pickaxe' ? 1 : (isToolRow ? 1 : getBackpackCapacity(rowKey));
    const isDraggedRow = craftingMenuOpen && leftMouseDown && i === draggedRowIndex;

    ctx.fillStyle = isDraggedRow ? '#2f2736' : '#221d27';
    ctx.fillRect(backpackX, y - 2, backpackW, 22);
    if (isDraggedRow) {
      ctx.strokeStyle = '#8fdfff';
      ctx.lineWidth = 1;
      ctx.strokeRect(backpackX + 0.5, y - 1.5, backpackW - 1, 21);
    }
    if (rowKey === 'hands') {
      ctx.fillStyle = '#e8e8ef';
      ctx.font = '10px "Planes ValMore", monospace';
      ctx.fillText('H', panelX + 23, y + 3);
    } else {
      drawItemIcon(rowKey, panelX + 20, y + 1, 14);
    }
    ctx.fillStyle = '#dfe7f3';
    const countText = formatBackpackCountText(rowKey, count);
    const countX = panelX + 112;
    const labelX = panelX + 40;
    const labelMaxWidth = Math.max(20, countX - labelX - 6);
    ctx.fillText(fitTextToWidth(backpackRowLabels[rowKey] ?? rowKey, labelMaxWidth), labelX, y + 1);
    ctx.fillStyle = '#c8d4e7';
    ctx.fillText(countText, countX, y + 1);
  }
  ctx.restore();

  if (backpackMaxScroll > 0) {
    const trackW = 6;
    const trackX = backpackX + backpackW - trackW - 2;
    const trackY = backpackViewportY + 2;
    const trackH = backpackViewportH - 4;
    const thumbH = Math.max(18, Math.round((backpackViewportH / backpackContentHeight) * trackH));
    const thumbTravel = Math.max(0, trackH - thumbH);
    const thumbY = trackY + Math.round((craftingBackpackScroll / backpackMaxScroll) * thumbTravel);
    ctx.fillStyle = '#17141c';
    ctx.fillRect(trackX, trackY, trackW, trackH);
    ctx.strokeStyle = '#394252';
    ctx.lineWidth = 1;
    ctx.strokeRect(trackX + 0.5, trackY + 0.5, trackW - 1, trackH - 1);
    ctx.fillStyle = '#8ea4bf';
    ctx.fillRect(trackX + 1, thumbY + 1, trackW - 2, Math.max(4, thumbH - 2));
  }

  const { recipeX, recipeW, cardY, cardH, listRect, detailRect, craftButtonRect } = getCraftingRecipeLayout();
  const recipeEntries = getCraftingRecipeEntries();
  const selectedRecipe = getSelectedCraftRecipeEntry();
  const selectedCraftCheck = selectedRecipe.canCraft();
  ctx.fillStyle = '#201a23';
  ctx.fillRect(recipeX, cardY, recipeW, cardH);
  ctx.strokeStyle = '#3f4652';
  ctx.lineWidth = 1;
  ctx.strokeRect(recipeX + 0.5, cardY + 0.5, recipeW - 1, cardH - 1);

  ctx.fillStyle = '#18161d';
  ctx.fillRect(listRect.x, listRect.y, listRect.w, listRect.h);
  ctx.strokeStyle = '#343c49';
  ctx.lineWidth = 1;
  ctx.strokeRect(listRect.x + 0.5, listRect.y + 0.5, listRect.w - 1, listRect.h - 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(listRect.x, listRect.y, listRect.w, listRect.h);
  ctx.clip();
  for (let i = 0; i < recipeEntries.length; i++) {
    const entry = recipeEntries[i];
    const rowRect = getCraftingRecipeListRowRect(i);
    if (rowRect.y + rowRect.h < listRect.y || rowRect.y > listRect.y + listRect.h) continue;
    const isSelected = entry.key === selectedRecipe.key;
    const isHover = pointInRect(mouseCanvasX, mouseCanvasY, rowRect);
    ctx.fillStyle = isSelected ? '#31273d' : (isHover ? '#26222d' : '#201c26');
    ctx.fillRect(rowRect.x, rowRect.y, rowRect.w, rowRect.h);
    if (isSelected) {
      ctx.strokeStyle = '#b58cff';
      ctx.strokeRect(rowRect.x + 0.5, rowRect.y + 0.5, rowRect.w - 1, rowRect.h - 1);
    }
    drawItemIcon(entry.iconKey, rowRect.x + 4, rowRect.y + 3, 14);
    ctx.fillStyle = '#e4eaf7';
    ctx.font = '10px "Planes ValMore", monospace';
    ctx.fillText(fitTextToWidth(entry.label, rowRect.w - 24), rowRect.x + 22, rowRect.y + 5);
  }
  ctx.restore();

  if (recipeListMaxScroll > 0) {
    const trackW = 6;
    const trackX = listRect.x + listRect.w - trackW - 2;
    const trackY = listRect.y + 2;
    const trackH = listRect.h - 4;
    const thumbH = Math.max(18, Math.round((listRect.h / recipeListContentHeight) * trackH));
    const thumbTravel = Math.max(0, trackH - thumbH);
    const thumbY = trackY + Math.round((craftingRecipeListScroll / recipeListMaxScroll) * thumbTravel);
    ctx.fillStyle = '#17141c';
    ctx.fillRect(trackX, trackY, trackW, trackH);
    ctx.strokeStyle = '#394252';
    ctx.lineWidth = 1;
    ctx.strokeRect(trackX + 0.5, trackY + 0.5, trackW - 1, trackH - 1);
    ctx.fillStyle = '#9aa9bf';
    ctx.fillRect(trackX + 1, thumbY + 1, trackW - 2, Math.max(4, thumbH - 2));
  }

  ctx.fillStyle = '#17151d';
  ctx.fillRect(detailRect.x, detailRect.y, detailRect.w, detailRect.h);
  ctx.strokeStyle = '#323a46';
  ctx.strokeRect(detailRect.x + 0.5, detailRect.y + 0.5, detailRect.w - 1, detailRect.h - 1);

  ctx.font = '11px "Planes ValMore", monospace';
  ctx.fillStyle = '#e8d8ff';
  ctx.fillText(fitTextToWidth(selectedRecipe.label, detailRect.w - 48), detailRect.x + 8, detailRect.y + 8);
  drawItemIcon(selectedRecipe.iconKey, detailRect.x + detailRect.w - 24, detailRect.y + 6, 16);

  ctx.fillStyle = '#b9c8dc';
  for (let i = 0; i < selectedRecipe.descriptionLines.length; i++) {
    ctx.fillText(fitTextToWidth(selectedRecipe.descriptionLines[i], detailRect.w - 16), detailRect.x + 8, detailRect.y + 24 + (i * 12));
  }

  ctx.font = '10px "Planes ValMore", monospace';
  const costStartX = detailRect.x + 8;
  const costY = detailRect.y + 50;
  for (let i = 0; i < selectedRecipe.costs.length; i++) {
    const [key, amount] = selectedRecipe.costs[i];
    const have = playerInventory.backpack[key] ?? 0;
    const x = costStartX + (i * 58);
    drawItemIcon(key, x, costY, 12);
    ctx.fillStyle = have >= amount ? '#cbffd0' : '#ffb6bf';
    ctx.fillText(`${have}/${amount}`, x + 14, costY - 1);
  }

  ctx.fillStyle = '#c9d2df';
  ctx.fillText(fitTextToWidth(`Owned: ${selectedRecipe.owned}`, detailRect.w - 16), detailRect.x + 8, detailRect.y + 70);

  const hoveringCraftButton = craftingMenuOpen && pointInRect(mouseCanvasX, mouseCanvasY, craftButtonRect);
  ctx.fillStyle = selectedCraftCheck.ok ? (hoveringCraftButton ? '#3d8350' : '#2f6d42') : '#4b2b32';
  ctx.fillRect(craftButtonRect.x, craftButtonRect.y, craftButtonRect.w, craftButtonRect.h);
  ctx.strokeStyle = selectedCraftCheck.ok ? '#9bf0b4' : '#a16a74';
  ctx.strokeRect(craftButtonRect.x + 0.5, craftButtonRect.y + 0.5, craftButtonRect.w - 1, craftButtonRect.h - 1);
  ctx.fillStyle = selectedCraftCheck.ok ? '#e7fff0' : '#e8c4cb';
  ctx.font = '11px "Planes ValMore", monospace';
  const buttonLabel = selectedCraftCheck.ok ? `Craft ${selectedRecipe.label}` : selectedCraftCheck.reason;
  const fittedButtonLabel = fitTextToWidth(buttonLabel, craftButtonRect.w - 10);
  const buttonLabelW = ctx.measureText(fittedButtonLabel).width;
  ctx.fillText(fittedButtonLabel, Math.round(craftButtonRect.x + (craftButtonRect.w - buttonLabelW) / 2), craftButtonRect.y + 6);

  ctx.restore();
}

function drawHud() {
  const grass = playerInventory.backpack.grass ?? 0;
  const dirt = playerInventory.backpack.dirt ?? 0;
  const stone = playerInventory.backpack.stone ?? 0;
  const wood = playerInventory.backpack.wood ?? 0;
  const willowSeeds = playerInventory.backpack.willowSeed ?? 0;
  const ladders = playerInventory.backpack.ladder ?? 0;
  const tripleJumpRunes = playerInventory.backpack.tripleJumpRune ?? 0;
  const levitationRunes = playerInventory.backpack.levitationRune ?? 0;
  const laserRunes = playerInventory.backpack.laserRune ?? 0;
  const { barX, barY, barWidth, barHeight, slotSize, slotGap } = getHotbarLayout();
  const slotCount = HOTBAR_SLOT_COUNT;
  const selectedSlotIndex = selectedHotbarSlotIndex;

  ctx.save();
  ctx.textBaseline = 'top';

  // Hotbar shell
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#15121a';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.strokeStyle = '#5a6270';
  ctx.lineWidth = 2;
  ctx.strokeRect(barX + 1, barY + 1, barWidth - 2, barHeight - 2);
  ctx.globalAlpha = 1;

  // Slots
  for (let i = 0; i < slotCount; i++) {
    const x = barX + 6 + (i * (slotSize + slotGap));
    const y = barY + 6;
    ctx.fillStyle = '#26222b';
    ctx.fillRect(x, y, slotSize, slotSize);
    ctx.strokeStyle = '#414755';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, slotSize - 1, slotSize - 1);

    if (i === selectedSlotIndex) {
      ctx.strokeStyle = '#e6f3ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, slotSize + 2, slotSize + 2);
    }

    // Slot labels/icons
    ctx.font = '10px "Planes ValMore", monospace';
    const slotItem = hotbarSlots[i];
    const isDraggedSlot = hotbarDrag && leftMouseDown && hotbarDrag.slotIndex === i && !craftingMenuOpen;
    if (isDraggedSlot) {
      ctx.strokeStyle = '#9ff3ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, slotSize + 1, slotSize + 1);
    }

    if (slotItem === 'pickaxe') {
      drawItemIcon('pickaxe', x + 6, y + 5, 18);
      if (playerInventory.pickaxe > 0) {
        ctx.fillStyle = '#b5f7a4';
        ctx.fillText(String(playerInventory.pickaxe), x + 22, y + 20);
      }
    } else if (slotItem === 'hands') {
      ctx.fillStyle = '#e8e8ef';
      ctx.fillText('H', x + 12, y + 10);
    } else if (slotItem === 'dirt') {
      drawItemIcon('dirt', x + 6, y + 5, 18);
      ctx.fillStyle = '#f4e7cb';
      ctx.font = '8px "Planes ValMore", monospace';
      ctx.fillText(`${dirt}`, x + 2, y + 22);
    } else if (slotItem === 'grass') {
      drawItemIcon('grass', x + 6, y + 5, 18);
      ctx.fillStyle = '#e8ffd5';
      ctx.font = '8px "Planes ValMore", monospace';
      ctx.fillText(`${grass}`, x + 2, y + 22);
    } else if (slotItem === 'ladder') {
      drawItemIcon('ladder', x + 6, y + 5, 18);
      ctx.fillStyle = '#e7e3c9';
      ctx.font = '8px "Planes ValMore", monospace';
      ctx.fillText(`${ladders}`, x + 2, y + 22);
    } else if (slotItem === 'tripleJumpRune') {
      drawItemIcon('tripleJumpRune', x + 6, y + 5, 18);
      ctx.fillStyle = '#ead6ff';
      ctx.fillText(`${tripleJumpRunes}`, x + 2, y + 22);
    } else if (slotItem === 'levitationRune') {
      drawItemIcon('levitationRune', x + 6, y + 5, 18);
      ctx.fillStyle = '#ffd1d8';
      ctx.fillText(`${levitationRunes}`, x + 2, y + 22);
    } else if (slotItem === 'laserRune') {
      const laserIconTint = lerpHexColor('#22ff68', '#ff2f3c', laserRuneIconHeat);
      if (!drawRuneIcon(x + 6, y + 5, 18, laserIconTint, 0.8)) {
        drawItemIcon('laserRune', x + 6, y + 5, 18);
      }
      ctx.fillStyle = laserRuneIconHeat > 0.5 ? '#ffd2d8' : '#c8ffd7';
      ctx.fillText(`${laserRunes}`, x + 2, y + 22);
    } else if (slotItem && (slotItem in playerInventory.backpack)) {
      drawItemIcon(slotItem, x + 6, y + 5, 18);
      ctx.fillStyle = '#dbe2f3';
      ctx.font = '8px "Planes ValMore", monospace';
      const slotCountMap = {
        stone,
        wood,
        willowSeed: willowSeeds,
        iron: playerInventory.backpack.iron ?? 0,
        gold: playerInventory.backpack.gold ?? 0,
        diamond: playerInventory.backpack.diamond ?? 0
      };
      const amount = slotCountMap[slotItem] ?? (playerInventory.backpack[slotItem] ?? 0);
      ctx.fillText(`${amount}`, x + 2, y + 22);
    }

    ctx.fillStyle = '#8c93a2';
    ctx.font = '10px "Planes ValMore", monospace';
    ctx.fillText(String((i + 1) % 10), x + 2, y + 2);
  }

  // Reserve vertical space for toasts above the hotbar.
  const titleY = barY - 17;

  // Toast above hotbar
  if (hudToastTimer > 0 && hudToastText) {
    ctx.font = '12px "Planes ValMore", monospace';
    const toastWidth = ctx.measureText(hudToastText).width;
    const toastX = Math.round((canvas.width - toastWidth) / 2);
    const toastY = titleY - 31;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#141a20';
    ctx.fillRect(toastX - 8, toastY - 2, toastWidth + 16, 18);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#5ce6ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(toastX - 7.5, toastY - 1.5, toastWidth + 15, 17);
    ctx.fillStyle = '#9ff3ff';
    ctx.fillText(hudToastText, toastX, toastY + 1);
  }
  ctx.restore();
}

function drawHeldPickaxe() {
  if (!pickaxeImg || !playerInventory.pickaxe || equippedTool !== 'Pickaxe') return;

  const handOffsetX = playerDirection === 'Left' ? PICKAXE_HAND_OFFSET_LEFT_X : PICKAXE_HAND_OFFSET_RIGHT_X;
  const handOffsetY = playerDirection === 'Left' ? PICKAXE_HAND_OFFSET_LEFT_Y : PICKAXE_HAND_OFFSET_RIGHT_Y;
  const breathPhase = cameraBreathTime * CAMERA_BREATH_SPEED;
  const isBreathingPose = !climbing && onGround && Math.abs(velocityY) < 1;
  const handBreathX = isBreathingPose ? Math.sin(breathPhase * 0.9) * 0.35 : 0;
  const handBreathY = isBreathingPose ? Math.cos(breathPhase * 1.1) * 0.65 : 0;
  const handX = (playerX - cameraX) + handOffsetX + handBreathX;
  const handY = (playerY - cameraY) + handOffsetY + handBreathY;
  const size = 22 * zoom;
  const baseAngle = climbing ? -0.15 : (jumping ? -0.35 : -0.5);
  let angle = baseAngle + (isBreathingPose ? (Math.sin(breathPhase) * 0.04) : 0);
  if (pickaxeSwingTime > 0) {
    const t = 1 - (pickaxeSwingTime / PICKAXE_SWING_DURATION);
    const windup = Math.min(1, t * 2);
    const strike = Math.max(0, (t - 0.35) / 0.65);
    angle += (0.65 * windup) - (1.35 * strike);
  }

  ctx.save();
  ctx.translate(Math.round(handX * zoom), Math.round(handY * zoom));
  if (playerDirection === 'Left') {
    ctx.scale(-1, 1);
  }
  ctx.rotate(angle);
  ctx.drawImage(
    pickaxeImg,
    -size * 0.18,
    -size * 0.78,
    size,
    size
  );
  ctx.restore();
}

function drawHeldAxe() {
  if (!axeImg || (playerInventory.backpack.axe ?? 0) <= 0 || equippedTool !== 'Axe') return;

  const handOffsetX = playerDirection === 'Left' ? PICKAXE_HAND_OFFSET_LEFT_X : PICKAXE_HAND_OFFSET_RIGHT_X;
  const handOffsetY = playerDirection === 'Left' ? PICKAXE_HAND_OFFSET_LEFT_Y : PICKAXE_HAND_OFFSET_RIGHT_Y;
  const breathPhase = cameraBreathTime * CAMERA_BREATH_SPEED;
  const isBreathingPose = !climbing && onGround && Math.abs(velocityY) < 1;
  const handBreathX = isBreathingPose ? Math.sin(breathPhase * 0.9) * 0.35 : 0;
  const handBreathY = isBreathingPose ? Math.cos(breathPhase * 1.1) * 0.65 : 0;
  const handX = (playerX - cameraX) + handOffsetX + handBreathX;
  const handY = (playerY - cameraY) + handOffsetY + handBreathY;
  const size = 22 * zoom;
  const baseAngle = climbing ? -0.12 : (jumping ? -0.28 : -0.42);
  let angle = baseAngle + (isBreathingPose ? (Math.sin(breathPhase) * 0.04) : 0);
  if (pickaxeSwingTime > 0) {
    const t = 1 - (pickaxeSwingTime / PICKAXE_SWING_DURATION);
    const windup = Math.min(1, t * 2);
    const strike = Math.max(0, (t - 0.35) / 0.65);
    angle += (0.55 * windup) - (1.25 * strike);
  }

  ctx.save();
  ctx.translate(Math.round(handX * zoom), Math.round(handY * zoom));
  if (playerDirection === 'Left') {
    ctx.scale(-1, 1);
  }
  ctx.rotate(angle);
  ctx.drawImage(
    axeImg,
    -size * 0.16,
    -size * 0.78,
    size,
    size
  );
  ctx.restore();
}

function drawLevitationElasticCharge(fromX, fromY, toX, toY, stacks = 1, tension = 0) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) return;

  const t = performance.now() * 0.02;
  const nx = dx / dist;
  const ny = dy / dist;
  const px = -ny;
  const py = nx;
  const clampedTension = Math.max(0, Math.min(1, tension));
  const bendStrength = (1 - (clampedTension * 0.7));
  const bend = Math.min(18, dist * 0.11) * (0.9 + (stacks * 0.18)) * bendStrength * Math.sin(t + (dist * 0.05));
  const mx = (fromX + toX) * 0.5;
  const my = (fromY + toY) * 0.5;
  const cx = mx + (px * bend);
  const cy = my + (py * bend);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.globalAlpha = 0.18 + (clampedTension * 0.16);
  ctx.strokeStyle = '#ff4b67';
  ctx.lineWidth = 4 + (stacks * 1.1) + (clampedTension * 1.3);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo(cx, cy, toX, toY);
  ctx.stroke();

  ctx.globalAlpha = 0.68 + (clampedTension * 0.25);
  ctx.strokeStyle = '#ffe4ea';
  ctx.lineWidth = 1.2 + (stacks * 0.35) + (clampedTension * 0.5);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo(cx, cy, toX, toY);
  ctx.stroke();

  // Short flicker highlights make the tether feel charged instead of static.
  for (let i = 1; i <= 2; i++) {
    const p = ((t * 0.04) + (i * 0.28)) % 1;
    const qx = (1 - p) * (1 - p) * fromX + 2 * (1 - p) * p * cx + p * p * toX;
    const qy = (1 - p) * (1 - p) * fromY + 2 * (1 - p) * p * cy + p * p * toY;
    ctx.globalAlpha = (0.5 + clampedTension * 0.25) - (i * 0.14);
    ctx.fillStyle = '#fff4f7';
    ctx.beginPath();
    ctx.arc(qx, qy, 1.3 + (stacks * 0.2) + (clampedTension * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawLaserTargetLockFx(x, y, chargeT = 1, stacks = 1) {
  const p = Math.max(0, Math.min(1, chargeT));
  const t = performance.now() * 0.02;
  const baseR = 8 + (stacks * 2);
  const pulseR = baseR + ((1 - p) * 14);

  ctx.save();
  ctx.translate(x, y);

  ctx.globalAlpha = 0.18 + (0.28 * (1 - p));
  ctx.fillStyle = '#2dff77';
  ctx.beginPath();
  ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = '#e8fff0';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, baseR + (Math.sin(t) * 0.8), 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#63ffa0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
  ctx.stroke();

  const arm = baseR + 5 + ((1 - p) * 3);
  const gap = Math.max(2, baseR - 2);
  ctx.beginPath();
  ctx.moveTo(-arm, 0); ctx.lineTo(-gap, 0);
  ctx.moveTo(arm, 0); ctx.lineTo(gap, 0);
  ctx.moveTo(0, -arm); ctx.lineTo(0, -gap);
  ctx.moveTo(0, arm); ctx.lineTo(0, gap);
  ctx.stroke();

  ctx.restore();
}

function drawLaserRunePowerupBurst(x, y, chargeT = 1, stacks = 1) {
  const p = Math.max(0, Math.min(1, chargeT));
  const time = performance.now() * 0.016;
  const rays = 6 + stacks;
  const radius = 7 + (stacks * 1.8) + (p * 4);

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.14 + (0.22 * p);
  ctx.strokeStyle = '#8affb4';
  ctx.lineWidth = 1;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * (Math.PI * 2) + time;
    const inner = radius * 0.55;
    const outer = radius + (Math.sin(time * 1.5 + i) * 1.2);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLaserRuneBeam(fromX, fromY, toX, toY, stacks = 1, intensity = 1) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;

  const beamI = Math.max(0.05, Math.min(1, intensity));
  const t = performance.now() * 0.02;
  const nx = dx / dist;
  const ny = dy / dist;

  ctx.save();
  ctx.lineCap = 'round';

  ctx.globalAlpha = (0.08 + 0.10 * beamI) * beamI + 0.05;
  ctx.strokeStyle = '#22ff68';
  ctx.lineWidth = (3.2 + (stacks * 1.4)) * (0.45 + beamI * 0.55);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.globalAlpha = 0.25 + (0.70 * beamI);
  ctx.strokeStyle = '#e6ffe9';
  ctx.lineWidth = (0.9 + (stacks * 0.35)) * (0.55 + beamI * 0.45);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Refracted energy packets travel in a straight line through the beam.
  for (let i = 0; i < 3; i++) {
    const p = ((t * (0.7 + i * 0.11)) + (i * 0.27)) % 1;
    const px = fromX + (dx * p);
    const py = fromY + (dy * p);
    ctx.globalAlpha = (0.15 + (0.10 * i)) + (0.35 * beamI);
    ctx.fillStyle = i === 0 ? '#9bffb8' : '#f4fff6';
    ctx.beginPath();
    ctx.arc(px, py, (0.8 + (stacks * 0.18) + (i * 0.35)) * (0.6 + beamI * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }

  // Small side rails keep the beam feeling rigid instead of floppy.
  ctx.globalAlpha = 0.06 + (0.16 * beamI);
  ctx.strokeStyle = '#73ff9b';
  ctx.lineWidth = 1;
  const railOffset = 1.4 + (stacks * 0.35);
  ctx.beginPath();
  ctx.moveTo(fromX + (-ny * railOffset), fromY + (nx * railOffset));
  ctx.lineTo(toX + (-ny * railOffset), toY + (nx * railOffset));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fromX - (-ny * railOffset), fromY - (nx * railOffset));
  ctx.lineTo(toX - (-ny * railOffset), toY - (nx * railOffset));
  ctx.stroke();

  ctx.globalAlpha = 0.14 + (0.21 * beamI);
  ctx.fillStyle = '#8bffab';
  ctx.beginPath();
  ctx.arc(toX, toY, (5 + (stacks * 1.6)) * (0.55 + beamI * 0.45), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.25 + (0.60 * beamI);
  ctx.fillStyle = '#effff2';
  ctx.beginPath();
  ctx.arc(toX, toY, (1.2 + (stacks * 0.4)) * (0.6 + beamI * 0.4), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawLaserFocusLine(fromX, fromY, toX, toY, alpha = 0.55) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalAlpha = Math.max(0.1, Math.min(1, alpha));
  ctx.strokeStyle = '#67ffa4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.globalAlpha = Math.max(0.15, Math.min(1, alpha + 0.2));
  ctx.strokeStyle = '#ecfff1';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.restore();
}

function drawLaserFocusCrystal(x, y, size, spin = 0, intensity = 1, cooldownHeat = 0) {
  const s = Math.max(4, size);
  const heat = Math.max(0, Math.min(1, cooldownHeat));
  const auraColor = lerpHexColor('#35ff7b', '#ff4b4b', heat);
  const coreColor = lerpHexColor('#b8ffd0', '#ffc0c7', heat);
  const edgeColor = lerpHexColor('#effff4', '#fff0f2', heat);
  const crossColor = lerpHexColor('#4dff8a', '#ff7d87', heat);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);

  ctx.globalAlpha = 0.2 + (0.18 * intensity);
  ctx.fillStyle = auraColor;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.95, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.95;
  ctx.fillStyle = coreColor;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.7, 0);
  ctx.lineTo(0, s);
  ctx.lineTo(-s * 0.7, 0);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.7, 0);
  ctx.lineTo(0, s);
  ctx.lineTo(-s * 0.7, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = crossColor;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.9);
  ctx.lineTo(0, s * 0.9);
  ctx.moveTo(-s * 0.55, 0);
  ctx.lineTo(s * 0.55, 0);
  ctx.stroke();

  ctx.restore();
}

function drawHeldRune() {
  if (!runeSpriteImg) return;
  const isTripleJumpRune = equippedTool === 'Triple Jump Rune';
  const isLevitationRune = equippedTool === 'Levitation Rune';
  const isLaserRune = equippedTool === 'Laser Rune';
  if (!isTripleJumpRune && !isLevitationRune && !isLaserRune) return;
  if (isTripleJumpRune && (playerInventory.backpack.tripleJumpRune ?? 0) <= 0) return;
  if (isLevitationRune && (playerInventory.backpack.levitationRune ?? 0) <= 0) return;
  if (isLaserRune && (playerInventory.backpack.laserRune ?? 0) <= 0) return;
  if (!runeSpriteImg.complete || runeSpriteImg.naturalWidth <= 0) return;

  const handOffsetX = playerDirection === 'Left' ? (PICKAXE_HAND_OFFSET_LEFT_X + 1) : (PICKAXE_HAND_OFFSET_RIGHT_X - 2);
  const handOffsetY = playerDirection === 'Left' ? (PICKAXE_HAND_OFFSET_LEFT_Y + 2) : (PICKAXE_HAND_OFFSET_RIGHT_Y + 2);
  const breathPhase = cameraBreathTime * CAMERA_BREATH_SPEED;
  const isBreathingPose = !climbing && onGround && Math.abs(velocityY) < 1;
  const handBreathX = isBreathingPose ? Math.sin(breathPhase * 0.9) * 0.35 : 0;
  const handBreathY = isBreathingPose ? Math.cos(breathPhase * 1.1) * 0.65 : 0;
  const handX = (playerX - cameraX) + handOffsetX + handBreathX;
  const handY = (playerY - cameraY) + handOffsetY + handBreathY;

  const frameCount = 4;
  const frameWidth = Math.floor(runeSpriteImg.naturalWidth / frameCount) || runeSpriteImg.naturalWidth;
  const frameHeight = runeSpriteImg.naturalHeight || frameWidth;
  const frameIndex = Math.floor((performance.now() / 180) % frameCount);
  const size = 14 * zoom;
  const baseAngle = climbing ? -0.08 : (jumping ? -0.2 : -0.12);
  const angle = baseAngle + (isBreathingPose ? (Math.sin(breathPhase) * 0.05) : 0);
  const levitationAssist = isLevitationRune ? getLevitationAssistState() : null;
  const levitationStacks = isLevitationRune ? Math.max(1, getLevitationRuneStacks()) : 0;
  const levitationTension = (levitationAssist && levitationAssist.active) ? 1 : 0;
  const laserStacks = isLaserRune ? Math.max(1, getLaserRuneStacks()) : 0;
  const laserRuneWorld = isLaserRune ? getLaserRuneFloatWorldPos() : null;
  const laserRuneScreenX = laserRuneWorld ? Math.round((laserRuneWorld.x - cameraX) * zoom) : 0;
  const laserRuneScreenY = laserRuneWorld ? Math.round((laserRuneWorld.y - cameraY) * zoom) : 0;
  const laserShotActive = isLaserRune && laserRuneShotTimer > 0;
  const laserCooldownActive = isLaserRune && laserRuneShotCooldownTimer > 0;
  const laserTargetScreenX = Math.round((laserRuneTargetWorldX - cameraX) * zoom);
  const laserTargetScreenY = Math.round((laserRuneTargetWorldY - cameraY) * zoom);
  const laserPowerupActive = isLaserRune && laserShotActive && laserRunePowerupTimer > 0;
  const laserCooldownHeat = isLaserRune ? getLaserRuneCooldownVisualHeat() : 0;
  const laserPowerupT = laserPowerupActive
    ? (1 - Math.max(0, Math.min(1, laserRunePowerupTimer / LASER_RUNE_POWERUP_SECONDS)))
    : 1;
  const laserBeamIntensity = laserShotActive
    ? (laserPowerupActive ? (0.18 + (0.82 * laserPowerupT)) : 1)
    : 0;

  if (laserShotActive) {
    drawLaserRuneBeam(
      laserRuneScreenX,
      laserRuneScreenY,
      laserTargetScreenX,
      laserTargetScreenY,
      laserStacks,
      laserBeamIntensity
    );
    drawLaserTargetLockFx(laserTargetScreenX, laserTargetScreenY, laserPowerupT, laserStacks);
  }
  if (!laserShotActive && laserCooldownActive) {
    drawLaserTargetLockFx(laserTargetScreenX, laserTargetScreenY, 1, laserStacks);
  }

  if (isLaserRune) {
    const tintedFrame = getTintedRuneFrame(frameIndex, Math.max(6, size * 0.72), frameWidth, frameHeight, '#22ff68', 0.78);
    const time = performance.now();
    const visibleRuneCount = Math.max(1, laserStacks);
    const orbitRadius = (size * 1.25) + ((visibleRuneCount - 1) * 2.4 * zoom);
    const deployT = getLaserRuneDeployProgress();

    for (let i = 0; i < visibleRuneCount; i++) {
      const orbitP = (i / Math.max(1, visibleRuneCount)) * (Math.PI * 2);
      const ang = orbitP + (time / 520) + (i * 0.3);
      const sx = laserRuneScreenX + (Math.cos(ang) * orbitRadius * deployT);
      const sy = laserRuneScreenY + (Math.sin(ang) * (orbitRadius * 0.55) * deployT) - (1.2 * zoom);
      drawLaserFocusLine(sx, sy, laserRuneScreenX, laserRuneScreenY, 0.35 + (0.18 * deployT));

      ctx.save();
      ctx.translate(Math.round(sx), Math.round(sy));
      ctx.rotate((time / 260) + i);
      if (tintedFrame) {
        ctx.drawImage(tintedFrame, -(size * 0.36), -(size * 0.36), size * 0.72, size * 0.72);
      } else {
        ctx.drawImage(
          runeSpriteImg,
          frameIndex * frameWidth, 0, frameWidth, frameHeight,
          -(size * 0.36),
          -(size * 0.36),
          size * 0.72,
          size * 0.72
        );
      }
      ctx.restore();
    }

    drawLaserFocusCrystal(
      laserRuneScreenX,
      laserRuneScreenY,
      (size * 0.55) + (laserStacks * 0.35 * zoom),
      (time / 700) % (Math.PI * 2),
      Math.min(1, 0.45 + (laserStacks * 0.18) + (laserPowerupActive ? (0.28 * (1 - laserPowerupT)) : 0)),
      laserCooldownHeat
    );
    if (laserPowerupActive) {
      drawLaserRunePowerupBurst(laserRuneScreenX, laserRuneScreenY, laserPowerupT, laserStacks);
    }

    return;
  }

  if (isLevitationRune && mouseCanvasX !== null && mouseCanvasY !== null) {
    const handScreenX = Math.round(handX * zoom);
    const handScreenY = Math.round(handY * zoom);
    const runeScreenX = Math.round(mouseCanvasX);
    const runeScreenY = Math.round(mouseCanvasY);
    const spin = (performance.now() / 220) % (Math.PI * 2);
    const tintedFrame = getTintedRuneFrame(frameIndex, size, frameWidth, frameHeight, '#ff2a45', 0.72);

    drawLevitationElasticCharge(handScreenX, handScreenY, runeScreenX, runeScreenY, levitationStacks, levitationTension);

    ctx.save();
    ctx.translate(runeScreenX, runeScreenY);
    ctx.rotate(spin);
    if (tintedFrame) {
      ctx.drawImage(tintedFrame, -size * 0.5, -size * 0.5, size, size);
    } else {
      ctx.drawImage(
        runeSpriteImg,
        frameIndex * frameWidth, 0, frameWidth, frameHeight,
        -size * 0.5,
        -size * 0.5,
        size,
        size
      );
    }
    ctx.globalAlpha = 0.22 + (levitationTension * 0.25);
    ctx.strokeStyle = '#ffd3dc';
    ctx.lineWidth = Math.max(1, (1.1 + (levitationTension * 0.5)) * zoom);
    ctx.beginPath();
    ctx.arc(0, 0, size * (0.62 + (levitationTension * 0.08)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(Math.round(handX * zoom), Math.round(handY * zoom));
  if (playerDirection === 'Left') {
    ctx.scale(-1, 1);
  }
  ctx.rotate(angle);
  if (isLevitationRune) {
    const tintedFrame = getTintedRuneFrame(frameIndex, size, frameWidth, frameHeight, '#ff2a45', 0.72);
    if (tintedFrame) {
      ctx.drawImage(
        tintedFrame,
        -size * 0.25,
        -size * 0.7,
        size,
        size
      );
    } else {
      ctx.drawImage(
        runeSpriteImg,
        frameIndex * frameWidth, 0, frameWidth, frameHeight,
        -size * 0.25,
        -size * 0.7,
        size,
        size
      );
    }
  } else {
    ctx.drawImage(
      runeSpriteImg,
      frameIndex * frameWidth, 0, frameWidth, frameHeight,
      -size * 0.25,
      -size * 0.7,
      size,
      size
    );
  }
  ctx.restore();
}

function drawHeldHotbarItemIcon() {
  const slotItem = hotbarSlots[selectedHotbarSlotIndex];
  if (!slotItem) return;
  if (slotItem === 'pickaxe' || slotItem === 'axe' || slotItem === 'hands' || slotItem === 'tripleJumpRune' || slotItem === 'levitationRune' || slotItem === 'laserRune') return;
  if (!(slotItem in playerInventory.backpack)) return;
  if ((playerInventory.backpack[slotItem] ?? 0) <= 0) return;
  if (equippedTool === 'Pickaxe' || equippedTool === 'Axe' || equippedTool === 'Hands' || equippedTool === 'Triple Jump Rune' || equippedTool === 'Levitation Rune' || equippedTool === 'Laser Rune') return;

  const handOffsetX = playerDirection === 'Left' ? (PICKAXE_HAND_OFFSET_LEFT_X + 2) : (PICKAXE_HAND_OFFSET_RIGHT_X - 1);
  const handOffsetY = playerDirection === 'Left' ? (PICKAXE_HAND_OFFSET_LEFT_Y + 3) : (PICKAXE_HAND_OFFSET_RIGHT_Y + 3);
  const breathPhase = cameraBreathTime * CAMERA_BREATH_SPEED;
  const isBreathingPose = !climbing && onGround && Math.abs(velocityY) < 1;
  const handBreathX = isBreathingPose ? Math.sin(breathPhase * 0.9) * 0.35 : 0;
  const handBreathY = isBreathingPose ? Math.cos(breathPhase * 1.1) * 0.65 : 0;
  const handX = (playerX - cameraX) + handOffsetX + handBreathX;
  const handY = (playerY - cameraY) + handOffsetY + handBreathY;
  const iconSize = 12 * zoom;
  const baseAngle = climbing ? -0.08 : (jumping ? -0.18 : -0.1);
  const angle = baseAngle + (isBreathingPose ? (Math.sin(breathPhase) * 0.04) : 0);

  ctx.save();
  ctx.translate(Math.round(handX * zoom), Math.round(handY * zoom));
  if (playerDirection === 'Left') ctx.scale(-1, 1);
  ctx.rotate(angle);
  drawItemIcon(slotItem, -iconSize * 0.25, -iconSize * 0.7, iconSize);
  ctx.restore();
}

function clone2DLayer(layer) {
  return layer.map((row) => row.slice());
}

function isValidSavedLayer(layer, expectedRows, expectedCols) {
  if (!Array.isArray(layer) || layer.length !== expectedRows) return false;
  return layer.every((row) => Array.isArray(row) && row.length >= expectedCols);
}

function saveGameState() {
  try {
    const payload = {
      version: SAVE_DATA_VERSION,
      seed: WORLD_SEED,
      player: {
        x: playerX,
        y: playerY,
        direction: playerDirection
      },
      inventory: {
        pickaxe: playerInventory.pickaxe,
        backpack: { ...playerInventory.backpack },
        backpackCapacity: { ...playerInventory.backpackCapacity }
      },
      ui: {
        equippedTool,
        hotbarSlots: hotbarSlots.slice(),
        selectedHotbarSlotIndex,
        backpackRowOrder: backpackRowOrder.slice()
      },
      world: {
        terrainLayer: clone2DLayer(terrainLayer),
        foregroundLayer: clone2DLayer(foregroundLayer),
        oreLayer: clone2DLayer(oreLayer),
        minedBackdropLayer: clone2DLayer(minedBackdropLayer),
        willowTrees: willowTrees.map((tree) => ({ ...tree })),
        willowSeedlings: willowSeedlings.map((seedling) => ({ ...seedling })),
        extraOreCleared: Array.from(extraOreCleared)
      }
    };
    localStorage.setItem(WORLD_SAVE_STORAGE_KEY, JSON.stringify(payload));
    gameStateDirty = false;
    return true;
  } catch (err) {
    return false;
  }
}

function loadGameState() {
  let raw = null;
  try {
    raw = localStorage.getItem(WORLD_SAVE_STORAGE_KEY);
  } catch (err) {
    return false;
  }
  if (!raw) return false;

  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return false;
  }
  if (!payload || payload.version !== SAVE_DATA_VERSION) return false;

  const expectedRows = terrainLayer.length;
  const expectedCols = terrainLayer[0].length;
  const world = payload.world || {};
  if (
    !isValidSavedLayer(world.terrainLayer, expectedRows, expectedCols) ||
    !isValidSavedLayer(world.foregroundLayer, expectedRows, expectedCols) ||
    !isValidSavedLayer(world.oreLayer, expectedRows, expectedCols) ||
    !isValidSavedLayer(world.minedBackdropLayer, expectedRows, expectedCols)
  ) {
    return false;
  }

  terrainLayer.splice(0, terrainLayer.length, ...world.terrainLayer.map((row) => row.slice()));
  foregroundLayer.splice(0, foregroundLayer.length, ...world.foregroundLayer.map((row) => row.slice()));
  oreLayer.splice(0, oreLayer.length, ...world.oreLayer.map((row) => row.slice()));
  minedBackdropLayer.splice(0, minedBackdropLayer.length, ...world.minedBackdropLayer.map((row) => row.slice()));
  if (Array.isArray(world.willowTrees)) {
    willowTrees = world.willowTrees.map((tree, idx) => ({
      id: typeof tree.id === 'string' ? tree.id : `willow-${idx + 1}`,
      x: typeof tree.x === 'number' ? tree.x : 0,
      baseY: typeof tree.baseY === 'number' ? tree.baseY : (getSurfaceGrassRow() * TILE_SIZE),
      variant: [1, 2, 3].includes(tree.variant) ? tree.variant : 1,
      cut: !!tree.cut
    }));
  }
  if (Array.isArray(world.willowSeedlings)) {
    willowSeedlings = world.willowSeedlings
      .filter((seedling) => seedling && Number.isInteger(seedling.col) && Number.isInteger(seedling.row))
      .map((seedling, idx) => {
        const plantedAtMs = typeof seedling.plantedAtMs === 'number' ? seedling.plantedAtMs : Date.now();
        const growAtMs = typeof seedling.growAtMs === 'number' ? seedling.growAtMs : (plantedAtMs + WILLOW_GROW_MIN_MS);
        return {
          id: typeof seedling.id === 'string' ? seedling.id : `seedling-${idx + 1}`,
          col: seedling.col,
          row: seedling.row,
          plantedAtMs,
          growAtMs: Math.max(plantedAtMs + 1000, growAtMs),
          variant: [1, 2, 3].includes(seedling.variant) ? seedling.variant : 1
        };
      });
  } else {
    willowSeedlings = [];
  }
  if (Array.isArray(world.extraOreCleared)) {
    extraOreCleared = new Set(world.extraOreCleared.filter((key) => typeof key === 'string'));
  } else {
    extraOreCleared = new Set();
  }

  willowEntityIdCounter = Math.max(
    willowEntityIdCounter,
    willowTrees.length + willowSeedlings.length + 1000
  );

  const savedInventory = payload.inventory || {};
  if (typeof savedInventory.pickaxe === 'number') {
    playerInventory.pickaxe = Math.max(0, savedInventory.pickaxe);
  }
  if (savedInventory.backpack && typeof savedInventory.backpack === 'object') {
    for (const key of Object.keys(playerInventory.backpack)) {
      if (typeof savedInventory.backpack[key] === 'number') {
        playerInventory.backpack[key] = Math.max(0, savedInventory.backpack[key]);
      }
    }
  }
  if (savedInventory.backpackCapacity && typeof savedInventory.backpackCapacity === 'object') {
    for (const key of Object.keys(playerInventory.backpackCapacity)) {
      if (typeof savedInventory.backpackCapacity[key] === 'number') {
        playerInventory.backpackCapacity[key] = Math.max(1, savedInventory.backpackCapacity[key]);
      }
    }
  }

  const savedUi = payload.ui || {};
  if (Array.isArray(savedUi.hotbarSlots) && savedUi.hotbarSlots.length === HOTBAR_SLOT_COUNT) {
    hotbarSlots = savedUi.hotbarSlots.slice(0, HOTBAR_SLOT_COUNT);
  }
  if (Number.isInteger(savedUi.selectedHotbarSlotIndex)) {
    selectedHotbarSlotIndex = Math.max(0, Math.min(HOTBAR_SLOT_COUNT - 1, savedUi.selectedHotbarSlotIndex));
  }
  if (Array.isArray(savedUi.backpackRowOrder) && savedUi.backpackRowOrder.length === backpackRowOrder.length) {
    const validKeys = new Set(Object.keys(backpackRowLabels));
    const unique = new Set(savedUi.backpackRowOrder);
    const allValid = savedUi.backpackRowOrder.every((key) => validKeys.has(key));
    if (allValid && unique.size === backpackRowOrder.length) {
      backpackRowOrder = savedUi.backpackRowOrder.slice();
    }
  }
  syncHotbarToBackpackTopItems();

  const savedPlayer = payload.player || {};
  if (typeof savedPlayer.x === 'number') {
    playerX = Math.max(0, Math.min(savedPlayer.x, mapPixelWidth - frameWidth));
  }
  if (typeof savedPlayer.y === 'number') {
    playerY = Math.max(0, Math.min(savedPlayer.y, mapPixelHeight - frameHeight));
  }
  if (savedPlayer.direction === 'Left' || savedPlayer.direction === 'Right') {
    playerDirection = savedPlayer.direction;
  }

  if (typeof savedUi.equippedTool === 'string') {
    equippedTool = savedUi.equippedTool;
  }
  syncEquippedToolToSelectedHotbarSlot();

  velocityY = 0;
  gameStateDirty = false;
  setHudToast('Save loaded');
  return true;
}

window.addEventListener('beforeunload', () => {
  if (gameStateDirty) saveGameState();
});
window.addEventListener('pagehide', () => {
  if (gameStateDirty) saveGameState();
});

const didLoadSave = loadGameState();
if (!didLoadSave) {
  syncHotbarToBackpackTopItems();
  playerY = groundYAtPlayer();
}

function getAncientGraveDrawRect(grave) {
  const img = ancientGraveImgs[grave.variant];
  const w = (img && img.naturalWidth) ? img.naturalWidth : TILE_SIZE;
  const h = (img && img.naturalHeight) ? img.naturalHeight : TILE_SIZE;
  return {
    x: grave.x,
    y: grave.baseY - h,
    w,
    h
  };
}

function drawAncientGraves() {
  for (const grave of ancientGraves) {
    const img = ancientGraveImgs[grave.variant];
    if (!img || !img.complete || img.naturalWidth <= 0) continue;
    const rect = getAncientGraveDrawRect(grave);
    ctx.drawImage(
      img,
      Math.round((rect.x - cameraX) * zoom),
      Math.round((rect.y - cameraY) * zoom),
      rect.w * zoom,
      rect.h * zoom
    );
  }
}

function getIndustrialBuildingDrawRect(building) {
  const img = industrialBuildingImgs[building.variant];
  const srcW = (img && img.naturalWidth) ? img.naturalWidth : INDUSTRIAL_BUILDING_FALLBACK_W;
  const srcH = (img && img.naturalHeight) ? img.naturalHeight : INDUSTRIAL_BUILDING_FALLBACK_H;
  const scale = (typeof building.scale === 'number' && building.scale > 0) ? building.scale : 1;
  const w = Math.max(TILE_SIZE * 2, Math.round(srcW * scale));
  const h = Math.max(TILE_SIZE * 2, Math.round(srcH * scale));
  return {
    x: building.x,
    y: building.baseY - h,
    w,
    h
  };
}

function drawIndustrialBuildings() {
  if (!industrialBuildings.length) return;
  const viewWidthWorld = canvas.width / zoom;
  const startX = cameraX - 128;
  const endX = cameraX + viewWidthWorld + 128;

  for (const building of industrialBuildings) {
    const rect = getIndustrialBuildingDrawRect(building);
    if ((rect.x + rect.w) < startX) continue;
    if (rect.x > endX) break;

    const img = industrialBuildingImgs[building.variant];
    if (!img || !img.complete || img.naturalWidth <= 0) continue;

    ctx.save();
    ctx.globalAlpha = (typeof building.alpha === 'number') ? building.alpha : 0.5;
    ctx.drawImage(
      img,
      Math.round((rect.x - cameraX) * zoom),
      Math.round((rect.y - cameraY) * zoom),
      rect.w * zoom,
      rect.h * zoom
    );
    ctx.restore();
  }
}

function getHauntedFlagDrawRect(flag) {
  const frameCount = 4;
  const frameW = (hauntedFlagImg && hauntedFlagImg.naturalWidth) ? Math.floor(hauntedFlagImg.naturalWidth / frameCount) : TILE_SIZE;
  const frameH = (hauntedFlagImg && hauntedFlagImg.naturalHeight) ? hauntedFlagImg.naturalHeight : (TILE_SIZE * 2);
  return {
    x: flag.x + Math.floor((TILE_SIZE - frameW) / 2),
    y: flag.baseY - frameH,
    w: frameW,
    h: frameH
  };
}

function drawHauntedFlags() {
  if (!hauntedFlagImg || !hauntedFlagImg.complete || hauntedFlagImg.naturalWidth <= 0) return;
  const frameCount = 4;
  const frameW = Math.floor(hauntedFlagImg.naturalWidth / frameCount) || hauntedFlagImg.naturalWidth;
  const frameH = hauntedFlagImg.naturalHeight || TILE_SIZE;
  const frameIndex = Math.floor((performance.now() / 180) % frameCount);

  for (const flag of hauntedFlags) {
    const rect = getHauntedFlagDrawRect(flag);
    ctx.drawImage(
      hauntedFlagImg,
      frameIndex * frameW, 0, frameW, frameH,
      Math.round((rect.x - cameraX) * zoom),
      Math.round((rect.y - cameraY) * zoom),
      rect.w * zoom,
      rect.h * zoom
    );
  }
}

function drawHauntedBiomeOverlay() {
  const biomeBlend = getCameraHauntedBiomeBlend();
  if (biomeBlend <= 0) return;
  const surfaceBandY = Math.max(0, (getSurfaceGrassRow() * TILE_SIZE - cameraY) * zoom - 140);

  ctx.save();
  // Darker haunted haze, fading smoothly at biome edges.
  ctx.globalAlpha = 0.24 * biomeBlend;
  ctx.fillStyle = '#0f0c14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Purple-gray tint over the visible scene.
  ctx.globalAlpha = 0.18 * biomeBlend;
  ctx.fillStyle = '#493a58';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Stronger eerie mist near the surface line.
  ctx.globalAlpha = 0.28 * biomeBlend;
  ctx.fillStyle = '#7f8aa8';
  ctx.fillRect(0, Math.max(0, surfaceBandY), canvas.width, 90);
  ctx.restore();
}

function drawHauntedFogFront() {
  const biomeBlend = Math.max(getCameraHauntedBiomeBlend(), getPlayerHauntedBiomeBlend());
  if (biomeBlend <= 0) return;

  const t = performance.now() * 0.00035;
  const surfaceY = Math.max(0, (getSurfaceGrassRow() * TILE_SIZE - cameraY) * zoom);

  ctx.save();

  // Low-lying fog bank hugging the ground line.
  ctx.globalAlpha = 0.08 * biomeBlend;
  ctx.fillStyle = '#d4dceb';
  ctx.fillRect(0, Math.max(0, surfaceY - 12), canvas.width, 54);

  // Drifting fog wisps in front of the scene/player.
  for (let layer = 0; layer < 3; layer++) {
    const layerSpeed = 0.65 + (layer * 0.28);
    const yBase = surfaceY - 36 + (layer * 20);
    const puffCount = 5 + layer;

    for (let i = 0; i < puffCount; i++) {
      const cycleW = canvas.width + 260;
      const drift = ((t * layerSpeed * 240) + (i * 137) + (layer * 53)) % cycleW;
      const x = drift - 130;
      const y = yBase + Math.sin((t * 6.5) + (i * 0.9) + (layer * 1.7)) * (4 + layer * 2);
      const w = 56 + (layer * 26) + ((i % 3) * 14);
      const h = 14 + (layer * 5) + ((i % 2) * 3);

      ctx.globalAlpha = (0.06 + layer * 0.035 + ((i % 2) * 0.01)) * biomeBlend;
      ctx.fillStyle = (i % 3 === 0) ? '#eef3ff' : '#cfd8eb';
      ctx.beginPath();
      ctx.ellipse(Math.round(x), Math.round(y), w, h, 0, 0, Math.PI * 2);
      ctx.fill();

      // Soft trailing tail gives the fog some motion smear without blur filters.
      ctx.globalAlpha = (0.025 + layer * 0.02) * biomeBlend;
      ctx.beginPath();
      ctx.ellipse(Math.round(x - (w * 0.45)), Math.round(y + 1), w * 0.72, h * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawHauntedSnow() {
  const biomeBlend = Math.max(getCameraHauntedBiomeBlend(), getPlayerHauntedBiomeBlend());
  if (biomeBlend <= 0) return;

  const t = performance.now() * 0.001;
  const flakeCount = Math.max(24, Math.floor(36 + (biomeBlend * 96)));

  ctx.save();
  ctx.globalAlpha = 0.10 * biomeBlend;
  ctx.fillStyle = '#d8e7ff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < flakeCount; i++) {
    const speed = 20 + ((i % 9) * 7);
    const fallY = ((t * speed * 20) + (i * 37)) % (canvas.height + 28);
    const driftSpeed = 10 + ((i % 5) * 3);
    const baseX = ((i * 61) + (t * driftSpeed * 10)) % (canvas.width + 32);
    const sway = Math.sin((t * (0.8 + ((i % 7) * 0.14))) + (i * 1.73)) * (2 + (i % 6));
    const x = Math.round(baseX + sway - 16);
    const y = Math.round(fallY - 14);
    const size = (i % 5 === 0) ? 2 : 1;

    ctx.globalAlpha = (0.22 + ((i % 4) * 0.08)) * biomeBlend;
    ctx.fillStyle = (i % 6 === 0) ? '#f8fbff' : '#dfeeff';
    ctx.fillRect(x, y, size, size);

    // A few elongated flakes add motion and make the snowfall read at low resolution.
    if (i % 7 === 0) {
      ctx.globalAlpha = 0.14 * biomeBlend;
      ctx.fillRect(x, y + size, 1, 2);
    }
  }

  ctx.restore();
}

function getLevitationAssistState() {
  const stacks = getLevitationRuneStacks();
  const spaceHeld = !!keys['Space'];
  if (stacks <= 0 || !spaceHeld || craftingMenuOpen || mouseCanvasX === null || mouseCanvasY === null) {
    return { active: false, stacks: 0, moveX: 0, accelY: 0, maxVelY: 0, gravityScale: 1 };
  }

  const playerCenterX = playerX + (frameWidth / 2);
  const playerCenterY = playerY + (frameHeight / 2);
  const mouseWorldX = cameraX + (mouseCanvasX / zoom);
  const mouseWorldY = cameraY + (mouseCanvasY / zoom);

  const dx = mouseWorldX - playerCenterX;
  const dy = mouseWorldY - playerCenterY;
  const maxLiftHeight = 180 + ((stacks - 1) * 90);
  const clampedDy = Math.max(-maxLiftHeight, dy);
  const dist = Math.hypot(dx, clampedDy);
  if (dist < 6) {
    return { active: false, stacks, moveX: 0, accelY: 0, maxVelY: 0, gravityScale: 1 };
  }

  const nx = dx / dist;
  const ny = clampedDy / dist;
  const pullT = Math.max(0.18, Math.min(1, dist / (80 + (stacks * 24))));
  const floatSpeed = (28 + (stacks * 14)) * pullT;
  const verticalAccel = ((780 + (stacks * 420)) * pullT) * (ny < 0 ? 1.5 : 0.8);
  const maxVelY = 130 + (stacks * 70);

  return {
    active: true,
    stacks,
    moveX: nx * floatSpeed,
    accelY: ny * verticalAccel,
    maxVelY,
    gravityScale: ny < 0
      ? Math.max(0.08, 0.20 - (stacks * 0.03))
      : Math.max(0.18, 0.38 - (stacks * 0.05))
  };
}


function gameLoop(timestamp) {
    let deltaTime = timestamp - lastTime;
    lastTime = timestamp;
    deltaTime = Math.min(deltaTime, 50);
    const dt = deltaTime / 1000;
    const frameStartPlayerX = playerX;
    const frameStartPlayerY = playerY;
    const frameStartDirection = playerDirection;

    let isMoving = false;
    let doubleJumping = false;
    let fallBrakeActive = false;
    const upKeyDown = !!keys['ArrowUp'];
    const downKeyDown = !!keys['ArrowDown'];
    const spaceKeyDown = !!keys['Space'];
    const levitationBandMode = (!craftingMenuOpen) && equippedTool === 'Levitation Rune' && getLevitationRuneStacks() > 0;
    const craftingKeyDown = !!keys['KeyE'];
    const mineClickDown = !craftingMenuOpen && leftMouseDown && !hotbarDrag;
    const placeClickDown = !craftingMenuOpen && leftMouseDown && !hotbarDrag;
    const hotbar1KeyDown = !!keys['Digit1'] || !!keys['Numpad1'] || !!keys['1'];
    const hotbar2KeyDown = !!keys['Digit2'] || !!keys['Numpad2'] || !!keys['2'];
    const hotbar3KeyDown = !!keys['Digit3'] || !!keys['Numpad3'] || !!keys['3'];
    const hotbar4KeyDown = !!keys['Digit4'] || !!keys['Numpad4'] || !!keys['4'];
    const hotbar5KeyDown = !!keys['Digit5'] || !!keys['Numpad5'] || !!keys['5'];
    const hotbar6KeyDown = !!keys['Digit6'] || !!keys['Numpad6'] || !!keys['6'];
    const hotbar7KeyDown = !!keys['Digit7'] || !!keys['Numpad7'] || !!keys['7'];
    const hotbar8KeyDown = !!keys['Digit8'] || !!keys['Numpad8'] || !!keys['8'];
    const hotbar9KeyDown = !!keys['Digit9'] || !!keys['Numpad9'] || !!keys['9'];

    if (craftingKeyDown && !craftingToggleConsumed) {
        craftingMenuOpen = !craftingMenuOpen;
        pickaxeSwingTime = 0;
        setHudToast(craftingMenuOpen ? 'Crafting open' : 'Crafting closed');
        craftingToggleConsumed = true;
    }
    if (!craftingKeyDown) {
        craftingToggleConsumed = false;
    }

    if (hudToastTimer > 0) {
        hudToastTimer = Math.max(0, hudToastTimer - dt);
        if (hudToastTimer === 0) {
            hudToastText = '';
        }
    }

    autosaveTimer += dt;
    if (autosaveTimer >= 2) {
        if (gameStateDirty) {
            saveGameState();
        }
        autosaveTimer = 0;
    }

    if (!craftingMenuOpen && !climbing && downKeyDown) {
        lookDownHoldTime = Math.min(10, lookDownHoldTime + dt);
    } else {
        lookDownHoldTime = 0;
    }

    if (pickaxeSwingTime > 0) {
        pickaxeSwingTime = Math.max(0, pickaxeSwingTime - dt);
    }
    if (laserRuneBeamCooldown > 0) {
        laserRuneBeamCooldown = Math.max(0, laserRuneBeamCooldown - dt);
    }
    if (laserRuneShotCooldownTimer > 0) {
        laserRuneShotCooldownTimer = Math.max(0, laserRuneShotCooldownTimer - dt);
    }
    if (laserRuneShotTimer > 0) {
        laserRuneShotTimer = Math.max(0, laserRuneShotTimer - dt);
        if (laserRuneShotTimer === 0) {
            laserRuneShotOriginLocked = false;
            laserRuneShotCooldownTimer = Math.max(laserRuneShotCooldownTimer, LASER_RUNE_SHOT_COOLDOWN_SECONDS);
        }
    }
    if (laserRunePowerupTimer > 0) {
        laserRunePowerupTimer = Math.max(0, laserRunePowerupTimer - dt);
    }
    updateLaserBeamHeat(dt);

    updateWillowSeedlings();

    if (hotbar1KeyDown && !hotbar1Consumed) {
        equipHotbarSlot(0);
        hotbar1Consumed = true;
    }
    if (!hotbar1KeyDown) {
        hotbar1Consumed = false;
    }

    if (hotbar2KeyDown && !hotbar2Consumed) {
        equipHotbarSlot(1);
        hotbar2Consumed = true;
    }
    if (!hotbar2KeyDown) {
        hotbar2Consumed = false;
    }

    if (hotbar3KeyDown && !hotbar3Consumed) {
        equipHotbarSlot(2);
        hotbar3Consumed = true;
    }
    if (!hotbar3KeyDown) {
        hotbar3Consumed = false;
    }

    if (hotbar4KeyDown && !hotbar4Consumed) {
        equipHotbarSlot(3);
        hotbar4Consumed = true;
    }
    if (!hotbar4KeyDown) {
        hotbar4Consumed = false;
    }
    if (hotbar5KeyDown && !hotbar5Consumed) {
        equipHotbarSlot(4);
        hotbar5Consumed = true;
    }
    if (!hotbar5KeyDown) {
        hotbar5Consumed = false;
    }

    if (hotbar6KeyDown && !hotbar6Consumed) {
        equipHotbarSlot(5);
        hotbar6Consumed = true;
    }
    if (!hotbar6KeyDown) {
        hotbar6Consumed = false;
    }

    if (hotbar7KeyDown && !hotbar7Consumed) {
        equipHotbarSlot(6);
        hotbar7Consumed = true;
    }
    if (!hotbar7KeyDown) {
        hotbar7Consumed = false;
    }

    if (hotbar8KeyDown && !hotbar8Consumed) {
        equipHotbarSlot(7);
        hotbar8Consumed = true;
    }
    if (!hotbar8KeyDown) {
        hotbar8Consumed = false;
    }

    if (hotbar9KeyDown && !hotbar9Consumed) {
        equipHotbarSlot(8);
        hotbar9Consumed = true;
    }
    if (!hotbar9KeyDown) {
        hotbar9Consumed = false;
    }

    let ladderInfo = getLadderInfoAtPlayerRect();
    if (!craftingMenuOpen && !climbing && upKeyDown && ladderInfo) {
        climbing = true;
        velocityY = 0;
        jumping = false;
        onGround = false;
        jumpConsumed = true; // prevent the same Up press from triggering jump
    }

    if (!craftingMenuOpen && climbing && spaceKeyDown && !jumpConsumed && !levitationBandMode) {
        climbing = false;
        velocityY = jumpForce;
        onGround = false;
        jumping = true;
        jumpConsumed = true;
        jumpsRemaining = Math.max(0, getMaxJumps() - 1);
    }

    const fallBrakeRequested = (!craftingMenuOpen) && spaceKeyDown && !levitationBandMode && !climbing && !onGround && velocityY > 0;
    const jumpKeyDown = (!craftingMenuOpen) && ((upKeyDown && !climbing) || (spaceKeyDown && !levitationBandMode && !fallBrakeRequested));

    if (!climbing && jumpKeyDown && !jumpConsumed && jumpsRemaining > 0) {
        velocityY = jumpForce;
        onGround = false;
        jumping = true;
        jumpConsumed = true;
        jumpsRemaining -= 1;
        if (jumpsRemaining === 0) {
            doubleJumping = true;
            jumpDustAnim.playing = true;
            jumpDustAnim.frameIndex = 0;
            jumpDustAnim.timer = 0;

        }
    }
    if (!jumpKeyDown) {
        jumpConsumed = false;
        doubleJumping = false;
    }

    if (mineClickDown && !pickaxeSwingConsumed && (playerInventory.backpack.axe ?? 0) > 0 && equippedTool === 'Axe') {
        if (tryCutWillowTree()) {
            pickaxeSwingTime = PICKAXE_SWING_DURATION;
            pickaxeSwingConsumed = true;
        }
    }

    if (mineClickDown && !pickaxeSwingConsumed && playerInventory.pickaxe > 0 && equippedTool === 'Pickaxe') {
        pickaxeSwingTime = PICKAXE_SWING_DURATION;
        pickaxeSwingConsumed = true;
        tryMineWithPickaxe();
    }
    if (!mineClickDown) {
        pickaxeSwingConsumed = false;
    }

    const laserRuneEquipped = (!craftingMenuOpen) && equippedTool === 'Laser Rune' && getLaserRuneStacks() > 0;
    if (laserRuneEquipped && leftMouseDown && !laserRuneFireConsumed && !hotbarDrag && mouseCanvasX !== null && mouseCanvasY !== null && laserRuneShotTimer <= 0 && laserRuneShotCooldownTimer <= 0) {
        const laserStacks = getLaserRuneStacks();
        const laserOrigin = getLaserRuneFloatWorldPos();
        laserRuneShotOriginWorldX = laserOrigin.x;
        laserRuneShotOriginWorldY = laserOrigin.y;
        laserRuneShotOriginLocked = true;
        laserRuneTargetWorldX = cameraX + (mouseCanvasX / zoom);
        laserRuneTargetWorldY = cameraY + (mouseCanvasY / zoom);
        laserRuneShotTimer = LASER_RUNE_SHOT_SECONDS_PER_CRYSTAL * Math.max(1, laserStacks);
        laserRunePowerupTimer = LASER_RUNE_POWERUP_SECONDS;
        laserRuneBeamCooldown = 0;
        laserRuneFireConsumed = true;
    }
    if (laserRuneEquipped && leftMouseDown && !laserRuneFireConsumed && !hotbarDrag && laserRuneShotTimer > 0) {
        setHudToast('Target locked');
        laserRuneFireConsumed = true;
    }
    if (laserRuneEquipped && leftMouseDown && !laserRuneFireConsumed && !hotbarDrag && laserRuneShotTimer <= 0 && laserRuneShotCooldownTimer > 0) {
        setHudToast(`Laser cooling ${Math.ceil(laserRuneShotCooldownTimer)}s`);
        laserRuneFireConsumed = true;
    }
    if (!leftMouseDown) {
        laserRuneFireConsumed = false;
    }

    if (placeClickDown && !placeConsumed && !!getPlaceableTileForEquippedItem()) {
        tryPlaceEquippedBlock();
        placeConsumed = true;
    }
    if (!placeClickDown) {
        placeConsumed = false;
    }

    if (!craftingMenuOpen && equippedTool === 'Laser Rune' && getLaserRuneStacks() > 0 && laserRuneShotTimer > 0) {
        if (laserRuneBeamCooldown <= 0) {
            applyLaserRuneBeamTick();
            laserRuneBeamCooldown = LASER_RUNE_TICK_INTERVAL;
        }
    }


    if (climbing) {
        sprinting = false;
        jumping = false;
        velocityY = 0;
        jumpsRemaining = getMaxJumps();

        ladderInfo = getLadderInfoAtPlayerRect() || ladderInfo;
        if (ladderInfo) {
            const ladderCenterX = ladderInfo.col * TILE_SIZE + (TILE_SIZE / 2);
            const targetPlayerX = ladderCenterX - (frameWidth / 2);
            playerX += (targetPlayerX - playerX) * Math.min(1, dt * 18);
            playerX = Math.max(0, Math.min(playerX, mapPixelWidth - frameWidth));

            let climbInput = 0;
            if (upKeyDown) climbInput -= 1;
            if (downKeyDown) climbInput += 1;

            if (climbInput !== 0) {
                playerY += climbInput * climbSpeed * dt;
                isMoving = true;
            }

            const groundOnLadder = groundYAtPlayer();
            if (playerY > groundOnLadder) {
                playerY = groundOnLadder;
            }

            if (!getLadderInfoAtPlayerRect()) {
                climbing = false;
            } else {
                onGround = false;
            }
        } else {
            climbing = false;
        }
    }

    if (!climbing) {
        const levitationAssist = getLevitationAssistState();
        if (levitationAssist.active) {
            movePlayerX(levitationAssist.moveX * dt);
            velocityY += levitationAssist.accelY * dt;
            velocityY = Math.max(-levitationAssist.maxVelY, Math.min(velocityY, levitationAssist.maxVelY));
        }
        velocityY += gravity * (levitationAssist.active ? levitationAssist.gravityScale : 1) * dt;
        fallBrakeActive = (!craftingMenuOpen) && spaceKeyDown && !levitationBandMode && !levitationAssist.active && !onGround && velocityY > 0;
        if (fallBrakeActive) {
            velocityY *= FALL_BRAKE_FALL_SPEED_MULTIPLIER;
        }
        const verticalHit = movePlayerY(velocityY * dt);
    if (verticalHit.hitTop && velocityY < 0) {
        velocityY = 0;
    }
        let groundedThisFrame = verticalHit.hitBottom && velocityY >= 0;
        if (!groundedThisFrame && velocityY >= 0) {
            const ground = groundYAtPlayer();
            if (playerY >= ground - 0.75) {
                playerY = ground;
                groundedThisFrame = true;
            }
        }

        if (groundedThisFrame) {
            velocityY = 0;
            onGround = true;
            jumping = false;
            jumpsRemaining = getMaxJumps();
        } else {
            onGround = false;
        }

        // Hard bottom-of-world collision in case terrain below is mined away.
        const worldBottomY = mapPixelHeight - frameHeight;
        if (playerY > worldBottomY) {
            playerY = worldBottomY;
            velocityY = 0;
            onGround = true;
            jumping = false;
        }
    }

    fallBrakeActive = (!craftingMenuOpen) && spaceKeyDown && !levitationBandMode && !climbing && !onGround && velocityY > 0;


    if (!craftingMenuOpen && !climbing && keys['ArrowLeft']) {
        if (playerX > 0 + frameWidth * zoom / 2) {
            if (keys['ShiftLeft']) {
                movePlayerX(-(speed * 1.5 * dt));
                isMoving = true;
                sprinting = true;
            } else {
                movePlayerX(-(speed * (fallBrakeActive ? FALL_BRAKE_IDLE_MOVE_SPEED_MULTIPLIER : 1) * dt));
                isMoving = true;
                sprinting = false;
            }
        }

        playerDirection = 'Left';
    }

    if (!craftingMenuOpen && !climbing && keys['ArrowRight']) {
        if (playerX < mapPixelWidth - frameWidth * zoom) {
            if (keys['ShiftLeft']) {
                movePlayerX(speed * 1.5 * dt);
                isMoving = true;
                sprinting = true;
            } else {
                movePlayerX(speed * (fallBrakeActive ? FALL_BRAKE_IDLE_MOVE_SPEED_MULTIPLIER : 1) * dt);
                isMoving = true;
                sprinting = false;
            }
        }
        playerDirection = 'Right';
    }

    const viewWidthWorld = canvas.width / zoom;
    const viewHeightWorld = canvas.height / zoom;
    const maxCameraX = Math.max(0, mapPixelWidth - viewWidthWorld);
    const maxCameraY = Math.max(0, mapPixelHeight - viewHeightWorld);
    cameraX = Math.max(0, Math.min(playerX - viewWidthWorld / 2 + frameWidth / 2, maxCameraX));
    cameraY = Math.max(0, Math.min(playerY - viewHeightWorld / 2 + frameHeight / 2, maxCameraY));
    cameraBaseY = cameraY;
    lookDownOffset = 0;
    cameraBreathTime += dt;


    const attackKeyDown = !craftingMenuOpen && keys['KeyX'];
    if (attackKeyDown && !attackConsumed && !attacking) {
        attacking = true;
        attackConsumed = true;
    }
    if (!attackKeyDown) {
        attackConsumed = false;
    }

    if (
        Math.abs(playerX - frameStartPlayerX) > 0.01 ||
        Math.abs(playerY - frameStartPlayerY) > 0.01 ||
        playerDirection !== frameStartDirection
    ) {
        markGameStateDirty();
    }


    function stepAnimation(anim, dtMs, frameCount) {
        anim.timer += dtMs;
        while (anim.timer >= frameDuration) {
            anim.frameIndex = (anim.frameIndex + 1) % frameCount;
            anim.timer -= frameDuration;
        }
    }
    function stepAnimationOnce(anim, dtMs, frameCount) {
        if (!anim.playing) return;
        anim.timer += dtMs;
        while (anim.timer >= frameDuration && anim.playing) {
            anim.timer -= frameDuration;
            if (anim.frameIndex >= frameCount - 1) {
                anim.playing = false;
            } else {
                anim.frameIndex += 1;
            }
        }
    }
    function stepPlayerAnimation(anim, dtMs, frameCount, loop, animFrameDuration = frameDuration) {
        anim.timer += dtMs;
        while (anim.timer >= animFrameDuration) {
            anim.timer -= animFrameDuration;
            if (loop) {
                anim.frameIndex = (anim.frameIndex + 1) % frameCount;
                continue;
            }

            if (anim.frameIndex >= frameCount - 1) {
                attacking = false;
                anim.timer = 0;
                break;
            }
            anim.frameIndex += 1;
        }
    }


    ctx.clearRect(0, 0, canvas.width, canvas.height);


    const backgroundCameraY = Math.max(0, cameraY - SURFACE_CAMERA_BASE_Y);
    animateBackground(layer1, bgX - cameraX * 0.2, bgY - backgroundCameraY * 0.15);
    animateBackground(layer2, bgX - cameraX * 0.4, bgY - backgroundCameraY * 0.25);
    animateBackground(layer3, bgX - cameraX * 0.6, bgY - backgroundCameraY * 0.35);
    animateBackground(layer4, bgX - cameraX * 0.8, bgY - backgroundCameraY * 0.45);
    drawDepthBackgroundFade();
    drawMinedBackdrops();
    drawMap();
    // Hide industrial skyline/buildings from the background.
    // drawIndustrialBuildings();
    drawOres();
    drawWillowSeedlings();
    drawWillowTrees();
    drawAncientGraves();
    drawHauntedFlags();
    drawForeground();
    drawHauntedBiomeOverlay();
    if (!craftingMenuOpen) {
        drawHoveredTileOutline();
    }

    let currentAnimName = 'idle';
    let currentFrameCount = 4;
    let currentImage = playerIdle;

    if (climbing) {
        currentAnimName = 'climb';
        currentFrameCount = 4;
        currentImage = playerClimb;
    } else if (jumping) {
        currentAnimName = 'jump';
        currentFrameCount = 8;
        currentImage = playerJump;
    } else if (isMoving && !attacking && !sprinting) {
        currentAnimName = 'walk';
        currentFrameCount = 6;
        currentImage = playerWalk;
    } else if (attacking && !isMoving) {
        currentAnimName = 'attack';
        currentFrameCount = 4;
        currentImage = playerAttack;
    } else if (attacking && isMoving) {
        currentAnimName = 'attackWalk';
        currentFrameCount = 4;
        currentImage = playerAttackWalk;
    } else if (sprinting && isMoving) {
        currentAnimName = 'run';
        currentFrameCount = 6;
        currentImage = playerRun;

        if (!dustAnim.playing) {
            dustAnim.playing = true;
            dustAnim.frameIndex = 0;
            dustAnim.timer = 0;
        }
    }

    if (!sprinting || !isMoving) {
        dustAnim.playing = false;
        dustAnim.frameIndex = 0;
    }

    if (playerAnim.name !== currentAnimName) {
        playerAnim.name = currentAnimName;
        playerAnim.frameIndex = 0;
        playerAnim.timer = 0;
    }



    const isAttackAnim = currentAnimName === 'attack' || currentAnimName === 'attackWalk';
    if (currentAnimName === 'climb' && !isMoving) {
        playerAnim.timer = 0;
        playerAnim.frameIndex = 0;
    } else {
        const playerAnimFrameDuration =
            (currentAnimName === 'jump' && velocityY > 0)
                ? FALL_ANIMATION_FRAME_DURATION
                : frameDuration;
        stepPlayerAnimation(playerAnim, deltaTime, currentFrameCount, !isAttackAnim, playerAnimFrameDuration);
    }
    stepAnimationOnce(jumpDustAnim, deltaTime, 5);
    stepAnimationOnce(dustAnim, deltaTime, 6);

    if (dustAnim.playing) {
        animate(
            dustAnim.frameIndex,
            dustFloor,
            playerX - cameraX + (10 * (playerDirection === 'Right' ? -1 : 1)),
            playerY - cameraY - 1,
            playerDirection
        );
    }
    animate(playerAnim.frameIndex, currentImage, playerX - cameraX, playerY - cameraY, playerDirection);
    drawHeldPickaxe();
    drawHeldAxe();
    drawHeldRune();
    drawHeldHotbarItemIcon();
    if (jumpDustAnim.frameIndex === 0 && jumpDustAnim.playing) {
        dustX = playerX;
        dustY = playerY + 6;
    }
    if (jumpDustAnim.playing) {
        animate(jumpDustAnim.frameIndex, jumpDust, dustX - cameraX, dustY - cameraY, playerDirection);
    }
    drawHauntedFogFront();
    drawHauntedSnow();
    drawHud();
    if (craftingMenuOpen) {
        drawCraftingMenu();
    }

    requestAnimationFrame(gameLoop);

}

requestAnimationFrame(gameLoop);
