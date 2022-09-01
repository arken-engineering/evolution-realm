import jetpack from 'fs-jetpack'
import axios from 'axios'
import semver from 'semver/preload.js'
import { log, logError, getTime, shuffleArray, random, randomPosition, sha256, decodePayload, isNumeric } from '@rune-backend-sdk/util'
import { ItemAttributes } from '@rune-backend-sdk/data/items'

const path = require('path')
const shortId = require('shortid')

const mapData = jetpack.read(path.resolve('./public/data/map.json'), 'json')

const serverVersion = "1.6.3"
let observers = []
const testMode = false
let roundLoopTimeout
const addressToUsername = {}
let announceReboot = false
let rebootAfterRound = false
const debugQueue = false
const killSameNetworkClients = true
const sockets = {} // to storage sockets
const clientLookup = {}
const powerups = []
const powerupLookup = {}
let currentReward
const orbs = []
const orbLookup = {}
let eventQueue = []
let clients = [] // to storage clients
let lastReward
let lastLeaderName
let round = {
  startedAt: Math.round(getTime() / 1000),
  endedAt: null,
  events: [],
  states: [],
  players: []
}
const ranks = {}
const realmServer = {
  socket: undefined
}
const ioCallbacks = {}

const pandas = [
  '0x150F24A67d5541ee1F8aBce2b69046e25d64619c',
  '0x3551691499D740790C4511CDBD1D64b2f146f6Bd',
  '0x1a367CA7bD311F279F1dfAfF1e60c4d797Faa6eb',
  '0x82b644E1B2164F5B81B3e7F7518DdE8E515A419d',
  '0xeb3fCb993dDe8a2Cd081FbE36238E4d64C286AC0'
]

let baseConfig = {
  id: undefined,
  roundId: 1,
  damagePerTouch: 2,
  periodicReboots: false,
  startAvatar: 0,
  spriteXpMultiplier: 1,
  forcedLatency: 20,
  isRoundPaused: false,
  level2forced: false,
  level2allowed: true,
  level2open: false,
  level3open: false,
  hideMap: false,
  dynamicDecayPower: true,
  decayPowerPerMaxEvolvedPlayers: 0.6,
  pickupCheckPositionDistance: 1,
  playersRequiredForLevel2: 15,
  preventBadKills: false,
  colliderBuffer: 0.05,
  stickyIslands: false,
  antifeed2: true,
  antifeed3: false,
  antifeed4: true,
  isBattleRoyale: false,
  isGodParty: false,
  isRuneRoyale: false,
  avatarDirection: 1,
  calcRoundRewards: true,
  flushEventQueueSeconds: 0.02,
  log: {
    connections: false
  },
  anticheat: {
    enabled: false,
    samePlayerCantClaimRewardTwiceInRow: false,
    disconnectPositionJumps: false
  },
  optimization: {
    sendPlayerUpdateWithNoChanges: true
  }
}

const sharedConfig = {
  antifeed1: true,
  avatarDecayPower0: 1.5,
  avatarDecayPower1: 2.5,
  avatarDecayPower2: 3,
  avatarTouchDistance0: 0.25 * 0.7,
  avatarTouchDistance1: 0.45 * 0.7,
  avatarTouchDistance2: 0.65 * 0.7,
  avatarSpeedMultiplier0: 1,
  avatarSpeedMultiplier1: 1,
  avatarSpeedMultiplier2: 0.85,
  baseSpeed: 3,
  cameraSize: 3,
  checkConnectionLoopSeconds: 2,
  checkInterval: 1,
  checkPositionDistance: 2,
  claimingRewards: false,
  decayPower: 2,
  disconnectPlayerSeconds: testMode ? 999 : 30,
  disconnectPositionJumps: true, // TODO: remove
  fastestLoopSeconds: 0.02,
  fastLoopSeconds: 0.04,
  gameMode: 'Standard',
  immunitySeconds: 5,
  isMaintenance: false,
  leadercap: false,
  maxEvolves: 3,
  noBoot: testMode,
  noDecay: testMode,
  orbCutoffSeconds: testMode? 0 : 60,
  orbOnDeathPercent: 25,
  orbTimeoutSeconds: testMode ? 3 : 10,
  pickupDistance: 0.3,
  pointsPerEvolve: 1,
  pointsPerKill: 20,
  pointsPerOrb: 1,
  pointsPerPowerup: 1,
  pointsPerReward: 5,
  powerupXp0: 2,
  powerupXp1: 4,
  powerupXp2: 8,
  powerupXp3: 16,
  resetInterval: 3.1,
  rewardItemAmount: 0,
  rewardItemName: '?',
  rewardItemType: 0,
  rewardSpawnLoopSeconds: testMode ? 1 : 3 * 60 / 20,
  rewardWinnerAmount: 0,
  rewardWinnerName: 'ZOD',
  roundLoopSeconds: testMode ? 1 * 60 : 5 * 60,
  sendUpdateLoopSeconds: 3,
  slowLoopSeconds: 1,
  spritesPerPlayerCount: 1,
  spritesStartCount: 50,
  spritesTotal: 50
}

let config = {
  ...baseConfig,
  ...sharedConfig
}

const presets = [
  {
    gameMode: 'Standard',
    leadercap: true,
    weight: 20,
    pointsPerEvolve: 1,
    pointsPerPowerup: 1,
    pointsPerKill: 20,
    pointsPerReward: 5,
  },
  {
    gameMode: 'Lets Be Friends',
    leadercap: true,
    weight: 2,
    pointsPerKill: -200,
    orbOnDeathPercent: 0,
    antifeed1: false,
    antifeed2: false,
    calcRoundRewards: false,
    preventBadKills: false,
    guide: [
      'Game Mode - Lets Be Friends',
      '-200 Points Per Kill',
      'No Death Orbs'
    ]
  },
  {
    gameMode: 'Indiana Jones',
    leadercap: true,
    weight: 30,
    pointsPerEvolve: 0,
    pointsPerPowerup: 0,
    pointsPerKill: 1,
    pointsPerReward: 100,
    pointsPerOrb: 1,
    baseSpeed: 4,
    cameraSize: 2.5,
    hideMap: true,
    orbOnDeathPercent: 0,
    guide: [
      'Game Mode - Indiana Jones',
      '+100 Points Per Treasure Found'
    ]
  },
  {
    gameMode: 'Mix Game 1',
    leadercap: true,
    weight: 1,
    pointsPerEvolve: 1,
    pointsPerPowerup: 1,
    pointsPerKill: 1,
    pointsPerReward: 50,
    pointsPerOrb: 1,
    isOmit: true,
  },
  {
    gameMode: 'Mix Game 2',
    leadercap: true,
    weight: 1,
    pointsPerEvolve: 10,
    pointsPerKill: 200,
    pointsPerReward: 20,
    isOmit: true,
  },
  {
    gameMode: 'Deathmatch',
    leadercap: true,
    weight: 50,
    pointsPerKill: 200,
    orbOnDeathPercent: 0,
    pointsPerEvolve: 0,
    pointsPerPowerup: 0,
    pointsPerReward: 1,
    pointsPerOrb: 0,
    baseSpeed: 3.5,
    antifeed1: false,
    // dynamicDecayPower: true,
    // decayPowerPerMaxEvolvedPlayers: 0.2,
    guide: [
      'Game Mode - Deathmatch',
      '+300 Points Per Kill (Per Evolve)',
      'No Death Orbs',
      'Faster Decay'
    ]
  },
  {
    gameMode: 'Evolution',
    leadercap: true,
    weight: 1,
    pointsPerKill: 0,
    pointsPerEvolve: 1,
    pointsPerPowerup: 0,
    pointsPerReward: 0,
    pointsPerOrb: 0,
    orbOnDeathPercent: 0,
    guide: [
      'Game Mode - Evolution',
      '+1 Points Per Evolution'
    ]
  },
  {
    gameMode: 'Classic Evolution',
    leadercap: true,
    weight: 10,
    pointsPerEvolve: 10,
    pointsPerPowerup: 0,
    pointsPerReward: 0,
    pointsPerOrb: 0,
    guide: [
      'Game Mode - Evolution',
      '+10 Points Per Evolution'
    ]
  },
  {
    gameMode: 'Orb Master',
    leadercap: true,
    weight: 10,
    // orbOnDeathPercent: 25,
    orbTimeoutSeconds: 3,
    pointsPerOrb: 300,
    pointsPerEvolve: 0,
    pointsPerReward: 0,
    pointsPerPowerup: 1,
    pointsPerKill: 0,
    orbCutoffSeconds: 0,
    guide: [
      'Game Mode - Orb Master',
      '+200 Points Per Orb Pickup',
      'No Points Per Kill, Evolve, etc.',
      'Orbs Last Until End of Round'
    ]
  },
  {
    gameMode: 'Sprite Leader',
    leadercap: true,
    weight: 10,
    spritesPerPlayerCount: 40,
    // decayPower: 7,
    avatarDecayPower0: 2,
    avatarDecayPower1: 2 * (7 / 1.4),
    avatarDecayPower2: 2 * (7 / 1.4),
    avatarSpeedMultiplier0: 1.2,
    avatarSpeedMultiplier1: 1,
    avatarSpeedMultiplier2: 0.85,
    // decayPowerPerMaxEvolvedPlayers: 2,
    pointsPerEvolve: 0,
    pointsPerPowerup: 1,
    pointsPerReward: 0,
    pointsPerKill: 0,
    pointsPerOrb: 0,
    immunitySeconds: 2,
    orbOnDeathPercent: 0,
    guide: [
      'Game Mode - Sprite Leader',
      '+3 Sprites Per Player',
      'No Points Per Kill, Evolve, etc.',
      'No Orbs',
      'Faster Decay',
      'Longer Immunity'
    ]
  },
  {
    gameMode: 'Fast Drake',
    leadercap: true,
    weight: 40,
    avatarDecayPower0: 1,
    avatarDecayPower1: 1,
    avatarDecayPower2: 1,
    avatarSpeedMultiplier2: 1.5,
    decayPower: 0.3,
    decayPowerPerMaxEvolvedPlayers: 25,
    immunitySeconds: 10,
    orbOnDeathPercent: 0,
    spritesPerPlayerCount: 20,
    level2forced: true,
    guide: [
      'Game Mode - Fast Drake',
      '+50% Speed as Black Drake',
      'Faster Decay',
      'Longer Immunity'
    ]
  },
  {
    gameMode: 'Bird Eye',
    leadercap: true,
    weight: 10,
    cameraSize: 6,
    baseSpeed: 3.5,
    decayPower: 2.8,
    pointsPerKill: 500,
    level2forced: true,
    guide: [
      'Game Mode - Bird Eye',
      'Faster Movement',
      'Faster Decay'
    ]
  },
  {
    gameMode: 'Friendly Reverse',
    leadercap: true,
    weight: 10,
    pointsPerKill: -200,
    orbOnDeathPercent: 0,
    antifeed1: false,
    antifeed2: false,
    pointsPerEvolve: 25,
    avatarSpeedMultiplier0: 1,
    avatarSpeedMultiplier1: 1,
    avatarSpeedMultiplier2: 1,
    decayPower: -3,
    dynamicDecayPower: false,
    avatarDecayPower0: 4,
    avatarDecayPower1: 3,
    avatarDecayPower2: 2,
    spriteXpMultiplier: -1,
    spritesPerPlayerCount: 10,
    preventBadKills: false,
    guide: [
      'Game Mode - Friendly Reverse',
      '-200 Points Per Kill (Per Evolve)',
      '+25 Points Per Evolve',
      'Reverse Evolution',
      'No Orbs'
    ]
  },
  {
    gameMode: 'Reverse Evolve',
    leadercap: true,
    weight: 1,
    startAvatar: 2,
    decayPower: -1,
    antifeed1: false,
    antifeed2: false,
    dynamicDecayPower: false,
    decayPowerPerMaxEvolvedPlayers: 2,
    avatarDecayPower0: 4,
    avatarDecayPower1: 3,
    avatarDecayPower2: 2,
    // avatarDecayPower0: 1.5,
    // avatarDecayPower1: 2.5,
    // avatarDecayPower2: 3,
    spriteXpMultiplier: -2,
    // avatarDirection: -1,
    guide: [
      'Game Mode - Reverse Evolve',
      'Evolution is reversed'
    ]
  },
  {
    gameMode: 'Classic Marco Polo',
    leadercap: true,
    weight: 30,
    cameraSize: 2,
    baseSpeed: 2.5,
    decayPower: 1.4,
    avatarSpeedMultiplier0: 1,
    avatarSpeedMultiplier1: 1,
    avatarSpeedMultiplier2: 1,
    // pointsPerReward: 20,
    hideMap: true,
    // level2forced: true,
    guide: [
      'Game Mode - Classic Marco Polo',
      'Zoomed in + no map',
      'Faster Decay'
    ]
  },
  {
    gameMode: 'Marco Polo',
    leadercap: true,
    weight: 20,
    cameraSize: 2,
    baseSpeed: 2.5,
    decayPower: 1.4,
    avatarSpeedMultiplier0: 1,
    avatarSpeedMultiplier1: 1,
    avatarSpeedMultiplier2: 1,
    pointsPerReward: 20,
    hideMap: true,
    level2forced: true,
    guide: [
      'Game Mode - Marco Polo',
      'Zoomed in + no map',
      'Sprites Change Camera',
    ]
  },
  // {
  //   gameMode: 'Leadercap',
  //   leadercap: true,
  //   guide: [
  //     'Game Mode - Leadercap',
  //     'Kill the last round leader',
  //     'Leader -20% Speed',
  //     'Leader 75% Death Orb'
  //   ]
  // },
  {
    gameMode: 'Sticky Mode',
    leadercap: true,
    weight: 1,
    stickyIslands: true,
    colliderBuffer: 0,
    pointsPerKill: 50,
    pointsPerOrb: 100,
    isOmit: true,
    guide: [
      'Game Mode - Sticky Mode',
      'Sticky islands'
    ]
  },
  {
    gameMode: 'Sprite Juice',
    leadercap: true,
    weight: 1,
    // spritesPerPlayerCount: 1,
    spritesStartCount: 25,
    spritesTotal: 25,
    decayPowerPerMaxEvolvedPlayers: 2,
    // antifeed1: false,
    // isOmit: true,
    guide: [
      'Game Mode - Sprite Juice',
      // 'Sprites have side effects!',
      'Purple - Increase Decay',
      'Pink - Decrease Speed',
      'Yellow - Increase Speed',
      'Blue - Shield',
    ]
  },
  // {
  //   gameMode: 'Friendly Pandamonium',
  //   weight: 1,
  //   isOmit: true,
  //   guide: [
  //     'Game Mode - Friendly Pandamonium',
  //     'Beware the Panda'
  //   ]
  // },
  {
    gameMode: 'Pandamonium',
    weight: 2,
    isOmit: true,
    isBattleRoyale: true,
    avatarSpeedMultiplier0: 1,
    avatarSpeedMultiplier1: 1,
    avatarSpeedMultiplier2: 1,
    guide: [
      'Game Mode - Pandamonium',
      'Beware the Panda'
    ]
  },
  {
    gameMode: 'Hayai',
    leadercap: true,
    weight: 2,
    level2forced: true,
    decayPower: 3.6,
    isOmit: true,
    guide: [
      'Game Mode - Hayai',
      'You feel energy growing around you...'
    ]
  },
  {
    gameMode: 'Storm Cuddle',
    leadercap: true,
    weight: 10,
    fortnight: true,
    isOmit: true,
  },
]

let currentPreset = presets[(Math.floor(Math.random() * presets.length))]
let roundConfig = {
  ...baseConfig,
  ...sharedConfig,
  ...currentPreset
}

const spawnBoundary1 = {
  x: {min: -17, max: 0},
  y: {min: -13, max: -4}
}

const spawnBoundary2 = {
  x: {min: -37, max: 0},
  y: {min: -13, max: -2}
}

const mapBoundary = {
  x: {min: -38, max: 2},
  y: {min: -20, max: 2}
}

const playerSpawnPoints = [
  {x: -4.14, y: -11.66},
  {x: -11.14, y: -8.55},
  {x: -12.27, y: -14.24},
  {x: -7.08, y: -12.75},
  {x: -7.32, y: -15.29},
]

//auxiliary function to sort the best players
function comparePlayers(a, b) {
  if (a.points > b.points) {
    // if (a.isDead) {
    //   return 1
    // }
    return -1
  }
  if (a.points < b.points) {
    // if (b.isDead) {
    //   return -1
    // }
    return 1
  }

  return 0
}

function emitAll(app, ...args) {
  // log('Emit All', ...args)
  app.io.emit(...args)
}

// function emitElse(socket, ...args) {
//   log('Emit Else', ...args)

//   if (!socket || !socket.emit) {
//     io.emit(...args)
//     return
//   }

//   socket.broadcast.emit('Events', getPayload([[...args]].map(e => `["${e[0]}","${e.slice(1).join(':')}"]`)))
//   // socket.broadcast.emit(...args)
// }

function emitDirect(socket, ...args) {
  if (!socket || !socket.emit) {
    log('Emit Direct failed', ...args)
    return
  }

  log('Emit Direct', ...args)

  const eventQueue = [[...args]]
  const compiled = []
  for (const e of eventQueue) {
    const name = e[0]
    const args = e.slice(1)
    
    compiled.push(`["${name}","${args.join(':')}"]`)

    round.events.push({ type: 'emitDirect', player: socket.id, name, args })
  }

  socket.emit('Events', getPayload(compiled))
}

// function emitAllFast(socket, ...args) {
//   log('Emit All Fast', ...args)

//   if (!socket || !socket.emit) {
//     io.emit(...args)
//     return
//   }

//   socket.emit(...args)
//   socket.broadcast.emit(...args)
// }

function publishEvent(...args) {
  // log(args)
  eventQueue.push(args)
}

async function rsCall(name, data = {}) {
  return new Promise((resolve, reject) => {
    const id = shortId()

    const timeout = setTimeout(function() {
      resolve({ status: 0, message: 'Request timeout' })

      delete ioCallbacks[id]
    }, 15 * 1000)
    
    ioCallbacks[id] = { resolve, reject, timeout }

    if (!realmServer.socket) {
      log('Error:', `Not connected to realm server. Call: ${name}`)
      resolve({ status: 0, message: 'Not connected to realm' })
      return
    }

    log('Emit Realm', name, { id, data })

    realmServer.socket.emit(name, { id, data })
  })
}

async function normalizeAddress(address) {
  if (!address) return false
  try {
    const res = await rsCall('GS_NormalizeAddressRequest', { address }) as any
    log('GS_NormalizeAddressResponse', res)
    return res.address
  } catch(e) {
    log('Error:', e)
    return false
  }
}

async function isValidSignatureRequest(req) {
  log('Verifying', req)
  if (!req.signature.address) return false
  if (req.signature.address.length !== 42 || req.signature.address.slice(0, 2) !== '0x') return false
  try {
    const res = await rsCall('GS_VerifySignatureRequest', req) as any
    return res.verified === true
  } catch(e) {
    log('Error:', e)
    return false
  }
}

function getClientSpeed(client, _config) {
  return client.overrideSpeed || normalizeFloat((_config.baseSpeed * config['avatarSpeedMultiplier' + client.avatar] * client.baseSpeed) * (1 + client.character.meta[ItemAttributes.EvolutionMovementSpeedIncrease.id]/100))
}

async function spawnRandomReward() {
  // return
  if (currentReward) {
    return
  }
  
  removeReward()

  const rewardRes = (await rsCall('GS_GetRandomRewardRequest') as any)

  if (rewardRes?.status !== 1) {
    return
  }

  const tempReward = rewardRes.reward

  if (!tempReward) {
    return
  }

  if (tempReward.type !== 'rune') {
    publishEvent('OnBroadcast', `Powerful Energy Detected - ${tempReward.rewardItemName}`, 3)
  }

  setTimeout(() => {
    currentReward = JSON.parse(JSON.stringify(tempReward))

    publishEvent('OnSpawnReward', currentReward.id, currentReward.rewardItemType, currentReward.rewardItemName, currentReward.quantity, currentReward.position.x, currentReward.position.y)

    setTimeout(() => {
      if (!currentReward) return
      if (currentReward.id !== tempReward.id) return
      
      removeReward()
    }, 30 * 1000)
  }, 3 * 1000)
}

function disconnectAllPlayers(app) {
  if (clients.length === 0) return

  log('Disconnecting all players')

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i]
    disconnectPlayer(app, client, 'disconnect all players')
  }
}

function monitorObservers(app) {
  updateObservers()

  if (observers.length === 0) {
    publishEvent('OnBroadcast', `Realm not connected. Contact support.`, 0)

    disconnectAllPlayers(app)
  }

  setTimeout(() => monitorObservers(app), 5 * 1000)
}

function moveVectorTowards(current, target, maxDistanceDelta) {
  const a = {
    x: target.x - current.x,
    y: target.y - current.y
  }

  const magnitude = Math.sqrt(a.x * a.x + a.y * a.y)

  if (magnitude <= maxDistanceDelta || magnitude == 0)
      return target

  return {
    x: current.x + a.x / magnitude * maxDistanceDelta,
    y: current.y + a.y / magnitude * maxDistanceDelta
  }
}

async function claimReward(player, reward) {
  if (!reward) return

  if (config.anticheat.samePlayerCantClaimRewardTwiceInRow && lastReward?.winner === player.name) return

  // const claimRewardRes = await rsCall('GS_ClaimRewardRequest', { reward, player }) as any

  // if (claimRewardRes.status !== 1) {
  //   publishEvent('OnBroadcast', `Problem claiming reward. Contact support.`, 3)
  // }

  reward.winner = player.name

  publishEvent('OnUpdateReward', player.id, reward.id)

  player.rewards += 1
  player.points += config.pointsPerReward
  player.pickups.push(reward)

  lastReward = reward

  currentReward = null
}

function randomizeSpriteXp() {
  const shuffledValues = shuffleArray([2, 4, 8, 16])
  config.powerupXp0 = shuffledValues[0]
  config.powerupXp1 = shuffledValues[1]
  config.powerupXp2 = shuffledValues[2]
  config.powerupXp3 = shuffledValues[3]
}

async function getUsername(address: string): Promise<string> {
  try {
    log(`Getting username for ${address}`)
    const response = await axios(`https://rune-api.binzy.workers.dev/users/${address}`)

    // const data = await response.json()

    const { username = '' } = response.data as any
  
    return username
  } catch (error) {
    return 'Guest' + Math.floor(Math.random() * 999)
  }
}

function distanceBetweenPoints(pos1, pos2) {
  return Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y)
}

function syncSprites() {
  log('Syncing sprites')
  const playerCount = clients.filter(c => !c.isDead && !c.isSpectating && !c.isGod).length
  const length = config.spritesStartCount + playerCount * config.spritesPerPlayerCount

  if (powerups.length > length) {
    const deletedPoints = powerups.splice(length)
  
    for (let i = 0; i < deletedPoints.length; i++) {
      publishEvent('OnUpdatePickup', 'null', deletedPoints[i].id, 0)
      // delete powerupLookup[deletedPoints[i].id]
    }

    config.spritesTotal = length
  } else if (length > powerups.length) {
    spawnSprites(length - powerups.length)
  }
}

function disconnectPlayer(app, player, reason = 'Unknown', immediate = false) {
  if (player.isRealm) return

  clients = clients.filter(c => c.id !== player.id)
  
  if (config.gameMode === 'Pandamonium') {
    publishEvent('OnBroadcast', `${clients.filter(c => !c.isDead && !c.isDisconnected && !c.isSpectating && !pandas.includes(c.address)).length} alive`, 0)
  }
  
  if (player.isDisconnected) return

  try {
    log(`Disconnecting (${reason})`, player.id, player.name)

    delete clientLookup[player.id]

    player.isDisconnected = true
    player.isDead = true
    player.joinedAt = 0
    player.latency = 0

    const oldSocket = sockets[player.id]

    setTimeout(function() {
      publishEvent('OnUserDisconnected', player.id)
      syncSprites()
      flushEventQueue(app)

      if (oldSocket.emit && oldSocket.connected)
        oldSocket.disconnect()
        delete sockets[player.id]
    }, immediate ? 0 : 1000)
  } catch(e) {
    log('Error:', e)
  }
}

function weightedRandom(items, weights) {
  let i

  for (i = 0; i < weights.length; i++)
      weights[i] += weights[i - 1] || 0
  
  let random = Math.random() * weights[weights.length - 1]
  
  for (i = 0; i < weights.length; i++)
      if (weights[i] > random)
          break
  
  return items[i]
}

function randomRoundPreset() {
  const gameMode = config.gameMode

  while(config.gameMode === gameMode) {
    const filteredPresets = presets.filter(p => !p.isOmit)

    currentPreset = weightedRandom(filteredPresets, filteredPresets.map(f => f.weight))
  
    roundConfig = {
      ...baseConfig,
      ...sharedConfig,
      ...currentPreset
    }
    config = JSON.parse(JSON.stringify(roundConfig))
  }
}

function removeSprite(id) {
  if (powerupLookup[id]) {
    delete powerupLookup[id]
  }
  
  for (let i = 0; i < powerups.length; i++) {
    if (powerups[i].id == id) {
      powerups.splice(i, 1)
    }
  }
}

function removeOrb(id) {
  if (orbLookup[id]) {
    delete orbLookup[id]
  }
  
  for (let i = 0; i < orbs.length; i++) {
    if (orbs[i].id == id) {
      orbs.splice(i, 1)
    }
  }
}

function removeReward() {
  if (!currentReward) return
  publishEvent('OnUpdateReward', 'null', currentReward.id)
  currentReward = undefined
}

function getUnobstructedPosition() {
  const spawnBoundary = config.level2open ? spawnBoundary2 : spawnBoundary1

  let res

  while(!res) {
    let collided = false

    const position = {
      x: randomPosition(spawnBoundary.x.min, spawnBoundary.x.max),
      y: randomPosition(spawnBoundary.y.min, spawnBoundary.y.max)
    }
  
    for (const gameObject of mapData) {
      if (!gameObject.Colliders || !gameObject.Colliders.length) continue

      for (const gameCollider of gameObject.Colliders) {
        const collider = {
          minX: gameCollider.Min[0],
          maxX: gameCollider.Max[0],
          minY: gameCollider.Min[1],
          maxY: gameCollider.Max[1]
        }

        if (config.level2open && gameObject.Name === 'Level2Divider') {
          const diff = 25
          collider.minY -= diff
          collider.maxY -= diff
        }

        if (
          position.x >= collider.minX &&
          position.x <= collider.maxX &&
          position.y >= collider.minY &&
          position.y <= collider.maxY
        ) {
          collided = true

          break
        }
      }

      if (collided) break
    }

    if (!collided) {
      res = position
    }
  }

  return res
}

function spawnSprites(amount) {
  for (let i = 0; i < amount; i++) {
    const position = getUnobstructedPosition()

    const powerupSpawnPoint = {
      id: shortId.generate(),
      type: (Math.floor(Math.random() * 4)),
      scale: 1,
      position
    }

    powerups.push(powerupSpawnPoint) // add power up on the list

    powerupLookup[powerupSpawnPoint.id] = powerupSpawnPoint //add powerup in search engine

    publishEvent('OnSpawnPowerUp', powerupSpawnPoint.id, powerupSpawnPoint.type, powerupSpawnPoint.position.x, powerupSpawnPoint.position.y, powerupSpawnPoint.scale)
  }

  config.spritesTotal = powerups.length
}

function addToRecentPlayers(player) {
  if (!player.address || !player.name) return

  round.players = round.players.filter(r => r.address !== player.address)

  round.players.push(player)
}

async function isValidAdminRequest(req) {
  log('Verifying Admin', req)
  if (!req.signature?.address) return false
  if (req.signature.address.length !== 42 || req.signature.address.slice(0, 2) !== '0x') return false
  try {
    const res = await rsCall('GS_VerifyAdminSignatureRequest', req) as any
    return res?.status === 1
  } catch(e) {
    log('Error:', e)
    return false
  }
}

function roundEndingSoon(sec) {
  const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
  return roundTimer < sec
}

const registerKill = (app, winner, loser) => {
  const now = getTime()

  if (config.isGodParty) return
  if (winner.isInvincible || loser.isInvincible) return
  if (winner.isGod || loser.isGod) return

  if (config.gameMode !== 'Pandamonium' || !pandas.includes(winner.address)) {
    if (config.preventBadKills && (winner.isPhased || now < winner.phasedUntil)) return

    const totalKills = winner.log.kills.filter(h => h === loser.hash).length
    const notReallyTrying = config.antifeed1 ? (totalKills >= 2 && loser.kills < 2 && loser.rewards <= 1) || (totalKills >= 2 && loser.kills < 2 && loser.powerups <= 100) : false
    const tooManyKills = config.antifeed2 ? clients.length > 2 && totalKills >= 5 && totalKills > winner.log.kills.length / clients.filter(c => !c.isDead).length : false
    const killingThemselves = config.antifeed3 ? winner.hash === loser.hash : false
    const allowKill = !notReallyTrying && !tooManyKills// && !killingThemselves

    if (notReallyTrying) {
      loser.log.notReallyTrying += 1
    }
    if (tooManyKills) {
      loser.log.tooManyKills += 1
    }
    if (killingThemselves) {
      loser.log.killingThemselves += 1
    }

    if (config.preventBadKills && !allowKill) {
      loser.phasedUntil = getTime() + 2000

      return
    }
  }

  if (config.gameMode === 'Pandamonium' && !pandas.includes(winner.address)) {
    return
  }

  // LV3 vs LV1 = 0.5 * 3 + 0.5 * 2 * 2 = 3.5
  // LV3 vs LV2 = 0.5 * 3 + 0.5 * 1 * 2 = 2.5
  // LV2 vs LV1 = 0.5 * 2 + 0.5 * 1 * 2 = 2
  // loser.xp -= config.damagePerTouch * (winner.avatar + 1) + config.damagePerTouch * (winner.avatar - loser.avatar) * 2

  // if (loser.avatar !== 0 || loser.xp > 0) {
  //   // Can't be killed yet
  //   return
  // }

  winner.kills += 1
  winner.points += config.pointsPerKill * (loser.avatar + 1)
  winner.log.kills.push(loser.hash)

  const orbOnDeathPercent = config.orbOnDeathPercent > 0 ? (config.leadercap && loser.name === lastLeaderName ? 50 : config.orbOnDeathPercent) : 0
  const orbPoints = Math.floor(loser.points * (orbOnDeathPercent / 100))

  loser.deaths += 1
  loser.points = Math.floor(loser.points * ((100 - orbOnDeathPercent) / 100))
  loser.isDead = true
  loser.log.deaths.push(winner.hash)
  

  if (winner.points < 0) winner.points = 0
  if (loser.points < 0) loser.points = 0

  if (winner.log.deaths.length && winner.log.deaths[winner.log.deaths.length-1] === loser.hash) {
    winner.log.revenge += 1
  }

  publishEvent('OnGameOver', loser.id, winner.id)

  // setTimeout(() => {
  disconnectPlayer(app, loser, 'got killed')
  // }, 2 * 1000)

  const orb = {
    id: shortId.generate(),
    type: 4,
    points: orbPoints,
    scale: orbPoints,
    enabledAt: now + config.orbTimeoutSeconds * 1000,
    position: {
      x: loser.position.x,
      y: loser.position.y
    }
  }

  const currentRound = config.roundId

  if (config.orbOnDeathPercent > 0 && !roundEndingSoon(config.orbCutoffSeconds)) {
    setTimeout(() => {
      if (config.roundId !== currentRound) return

      orbs.push(orb)
      orbLookup[orb.id] = orb
  
      publishEvent('OnSpawnPowerUp', orb.id, orb.type, orb.position.x, orb.position.y, orb.scale)
    }, config.orbTimeoutSeconds * 1000)
  }
}

function spectate(player) {
  try {
    // if (!player.isMod && !player.isGod) return
    if (config.isMaintenance && !player.isMod) return

    if (player.isSpectating) {
      // // if (!player.isMod) {
      //   disconnectPlayer(player)
      //   return
      // // }
  
      // player.isSpectating = false
      // player.isInvincible = false
      // player.isJoining = true
      // player.points = 0
      // player.xp = 100
      // player.avatar = config.startAvatar
      // player.speed = config.baseSpeed * config.avatarSpeedMultiplier0
      // player.overrideSpeed = null
      // player.cameraSize = config.cameraSize
      // player.overrideCameraSize = null
  
      // syncSprites()
  
      // publishEvent('OnUnspectate', player.id, player.speed, player.cameraSize)
    } else {
      player.isSpectating = true
      player.isInvincible = true
      player.points = 0
      player.xp = 0
      player.avatar = config.startAvatar
      player.speed = 7
      player.overrideSpeed = 7
      player.cameraSize = 8
      player.overrideCameraSize = 8
      player.log.spectating += 1
  
      syncSprites()
  
      publishEvent('OnSpectate', player.id, player.speed, player.cameraSize)
    }
  } catch(e) {
    log('Error:', e)
  }
}

function updateObservers() {
  observers = observers.filter(observer => observer.socket.connected)
}

function sendUpdates(app) {
  publishEvent('OnClearLeaderboard')

  const leaderboard = round.players.sort(comparePlayers).slice(0, 10)
  for (let j = 0; j < leaderboard.length; j++) {
    publishEvent('OnUpdateBestKiller', leaderboard[j].name, j, leaderboard[j].points, leaderboard[j].kills, leaderboard[j].deaths, leaderboard[j].powerups, leaderboard[j].evolves, leaderboard[j].rewards, leaderboard[j].isDead ? '-' : Math.round(leaderboard[j].latency), ranks[leaderboard[j].address]?.kills / 5 || 1)
  }

  flushEventQueue(app)
  
  setTimeout(() => sendUpdates(app), config.sendUpdateLoopSeconds * 1000)
}

function spawnRewards(app) {
  spawnRandomReward()

  setTimeout(() => spawnRewards(app), config.rewardSpawnLoopSeconds * 1000)
}

function getRoundInfo() {
  return Object.keys(sharedConfig).sort().reduce(
    (obj, key) => {
      obj.push(config[key])
      return obj;
    }, 
    []
  )
}

async function calcRoundRewards() {
  const calcRewardsRes = await rsCall('GS_ConfigureRequest', {
    clients
  }) as any
  
  if (calcRewardsRes?.data) {
    sharedConfig.rewardWinnerAmount = calcRewardsRes.data.rewardWinnerAmount
    config.rewardWinnerAmount = calcRewardsRes.data.rewardWinnerAmount
    sharedConfig.rewardItemAmount = calcRewardsRes.data.rewardItemAmount
    config.rewardItemAmount = calcRewardsRes.data.rewardItemAmount

    if (config.rewardWinnerAmount === 0 && calcRewardsRes.data.rewardWinnerAmount !== 0) {
      const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
      publishEvent('OnSetRoundInfo', roundTimer + ':' + getRoundInfo().join(':') + ':' + getGameModeGuide(config).join(':'))
    }
  }
}

let lastFastGameloopTime = getTime()
let lastFastestGameloopTime = getTime()

async function resetLeaderboard(preset = null) {
  try {
    if (config.gameMode === 'Pandamonium') {
      roundLoopTimeout = setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
      return
    }

    updateObservers()

    if (observers.length === 0) {
      publishEvent('OnBroadcast', `Realm not connected. Contact support.`, 0)
      roundLoopTimeout = setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
      return
    }

    round.endedAt =  Math.round(getTime() / 1000)

    const fiveSecondsAgo = getTime() - 7000
    const thirtySecondsAgo = getTime() - 30 * 1000

    const winners = round.players.filter(p => p.lastUpdate >= fiveSecondsAgo).sort((a, b) => b.points - a.points).slice(0, 10) //  && p.joinedRoundAt < thirtySecondsAgo

    if (winners.length) {
      lastLeaderName = winners[0].name
      log('Leader: ', winners[0])
    
      if (winners[0]?.address) {
        publishEvent('OnRoundWinner', winners[0].name)
      }

      if (config.isBattleRoyale) {
        publishEvent('OnBroadcast', `Top 5 - ${winners.slice(0, 5).map(l => l.name).join(', ')}`, 0)
      }
    }

    const saveRoundReq = rsCall('GS_SaveRoundRequest', {
      startedAt: round.startedAt,
      endedAt: round.endedAt,
      players: round.players,
      winners
    }) as any

    // clearInterval(problemInterval)

    saveRoundReq.then(function(saveRoundRes) {
      if (saveRoundRes?.status !== 1) {
        sharedConfig.rewardWinnerAmount = 0
        config.rewardWinnerAmount = 0
        sharedConfig.rewardItemAmount = 0
        config.rewardItemAmount = 0
  
        // if (!preset) {
          setTimeout(() => {
            publishEvent('OnBroadcast', `Maintanence`, 3)
    
            // clearTimeout(roundLoopTimeout)
    
            // resetLeaderboard()
          }, 30 * 1000)
        // }
      }
    })

    if (config.calcRoundRewards) {
      await calcRoundRewards()
    }

    if (preset) {
      roundConfig = {
        ...baseConfig,
        ...sharedConfig,
        ...preset
      }
      config = JSON.parse(JSON.stringify(roundConfig))
    }
    else {
      randomRoundPreset()
    }

    baseConfig.roundId = baseConfig.roundId + 1
    config.roundId = baseConfig.roundId

    round = null
    round = {
      startedAt: Math.round(getTime() / 1000),
      endedAt: null,
      players: [],
      events: [],
      states: [],
    }

    for (const client of clients) {
      if (!ranks[client.address]) ranks[client.address] = {}
      if (!ranks[client.address].kills) ranks[client.address].kills = 0

      ranks[client.address].kills += client.kills

      client.joinedRoundAt = getTime()
      client.points = 0
      client.kills = 0
      client.deaths = 0
      client.evolves = 0
      client.rewards = 0
      client.orbs = 0
      client.powerups = 0
      client.baseSpeed = 1
      client.decayPower = 1
      client.pickups = []
      client.xp = 50
      client.avatar = config.startAvatar
      client.speed = getClientSpeed(client, config)
      client.cameraSize = client.overrideCameraSize || config.cameraSize
      client.log = {
        kills: [],
        deaths: [],
        revenge: 0,
        resetPosition: 0,
        phases: 0,
        stuck: 0,
        collided: 0,
        timeoutDisconnect: 0,
        speedProblem: 0,
        clientDistanceProblem: 0,
        outOfBounds: 0,
        ranOutOfHealth: 0,
        notReallyTrying: 0,
        tooManyKills: 0,
        killingThemselves: 0,
        sameNetworkDisconnect: 0,
        connectedTooSoon: 0,
        clientDisconnected: 0,
        positionJump: 0,
        pauses: 0,
        connects: 0,
        path: '',
        positions: 0,
        spectating: 0,
        replay: []
      }
      client.gameMode = config.gameMode

      if (config.gameMode === 'Pandamonium' && pandas.includes(client.address)) {
        client.avatar = 2
        publishEvent('OnUpdateEvolution', client.id, client.avatar, client.speed)
      } else {
        publishEvent('OnUpdateRegression', client.id, client.avatar, client.speed)
      }

      if (client.isDead || client.isSpectating) continue

      client.startedRoundAt = Math.round(getTime() / 1000)

      round.players.push(client)
    }

    for (let i = 0; i < orbs.length; i++) {
      publishEvent('OnUpdatePickup', 'null', orbs[i].id, 0)
      // socket.broadcast.emit('UpdatePickup', currentPlayer.id, pack.id)
      // orbs.splice(i, 1)
    }

    orbs.splice(0, orbs.length)

    randomizeSpriteXp()

    syncSprites()

    const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
    publishEvent('OnSetRoundInfo', roundTimer + ':' + getRoundInfo().join(':') + ':' + getGameModeGuide(config).join(':'))

    log(roundTimer + ':' + getRoundInfo().join(':') + ':' + getGameModeGuide(config).join(':'), (config.roundLoopSeconds + ':' + getRoundInfo().join(':') + ':' + getGameModeGuide(config).join(':')).split(':').length)

    publishEvent('OnClearLeaderboard')

    publishEvent('OnBroadcast', `Game Mode - ${config.gameMode} (Round ${config.roundId})`, 0)

    if (config.hideMap) {
      publishEvent('OnHideMinimap')
      publishEvent('OnBroadcast', `Minimap hidden in this mode!`, 2)
    } else {
      publishEvent('OnShowMinimap')
    }

    if (config.periodicReboots && rebootAfterRound) {
      publishEvent('OnMaintenance', true)

      setTimeout(() => {
        process.exit()
      }, 3 * 1000)
    }

    if (config.periodicReboots && announceReboot) {
      const value = 'Restarting server at end of this round.'

      publishEvent('OnBroadcast', value, 1)
      
      rebootAfterRound = true
    }

    // for (const observer of observers) {
    //   observer.socket.emit('GS_StartRound')
    // }
  } catch(e) {
    log('Error:', e)
  }

  roundLoopTimeout = setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
}

function checkConnectionLoop(app) {
  if (!config.noBoot && !config.isRoundPaused) {
    const oneMinuteAgo = getTime() - (config.disconnectPlayerSeconds * 1000)
    // const oneMinuteAgo = Math.round(getTime() / 1000) - config.disconnectPlayerSeconds

    for (const client of clients) {
      if (client.isSpectating) continue
      if (client.isGod) continue
      if (client.isMod) continue
      if (client.isRealm) continue
      // if (client.isInvincible) continue
      // if (client.isDead) continue

      if (client.lastReportedTime <= oneMinuteAgo) {
        client.log.timeoutDisconnect += 1
        disconnectPlayer(app, client, 'timed out')
      }
    }
  }
  
  setTimeout(() => checkConnectionLoop(app), config.checkConnectionLoopSeconds * 1000)
}

function getPayload(messages) {
  // super-cheap JSON Array construction
  return Buffer.from([ '[', messages.join(','), ']' ].join(''));
}

//updates the list of best players every 1000 milliseconds
function slowGameloop(app) {
  if (config.dynamicDecayPower) {
    const players = clients.filter(p => !p.isDead && !p.isSpectating)
    const maxEvolvedPlayers = players.filter(p => p.avatar === config.maxEvolves - 1)
    
    // if (maxEvolvedPlayers.length > players.length / 2) {
      config.avatarDecayPower0 = roundConfig.avatarDecayPower0 + (maxEvolvedPlayers.length * config.decayPowerPerMaxEvolvedPlayers) * 0.33
      config.avatarDecayPower1 = roundConfig.avatarDecayPower1 + (maxEvolvedPlayers.length * config.decayPowerPerMaxEvolvedPlayers) * 0.66
      config.avatarDecayPower2 = roundConfig.avatarDecayPower1 + (maxEvolvedPlayers.length * config.decayPowerPerMaxEvolvedPlayers) * 1
    // }
  }

  // if (config.calcRoundRewards && config.rewardWinnerAmount === 0) {
  //   await calcRoundRewards()
  // }
  
  setTimeout(() => slowGameloop(app), config.slowLoopSeconds * 1000)
}

// function castVectorTowards(position, target, scalar) {
//   const magnitude = Math.sqrt(position.x * position.x + position.y * position.y)

//   return {
//     x: position.x + (target.x - position.x) / magnitude * scalar,
//     y: position.y + (target.y - position.y) / magnitude * scalar
//   }
// }

function resetPlayer(player) {
  const spawnPoint = playerSpawnPoints[(Math.floor(Math.random() * playerSpawnPoints.length))]
  player.position = spawnPoint
  player.target = spawnPoint
  player.clientPosition = spawnPoint
  player.clientTarget = spawnPoint
  player.avatar = 0
  player.xp = 50
}

function detectCollisions(app) {
  try {
    const now = getTime()
    const currentTime = Math.round(now / 1000)
    const deltaTime = (now - lastFastestGameloopTime) / 1000

    const distanceMap = {
      0: config.avatarTouchDistance0,
      1: config.avatarTouchDistance0,
      2: config.avatarTouchDistance0
    }

    // Update players
    for (let i = 0; i < clients.length; i++) {
      const player = clients[i]

      if (player.isDead) continue
      if (player.isSpectating) continue
      // if (player.isGod) continue
      if (player.isJoining) continue

      if (!Number.isFinite(player.position.x) || !Number.isFinite(player.speed)) { // Not sure what happened
        player.log.speedProblem += 1
        disconnectPlayer(app, player, 'speed problem')
        continue
      }

      if (distanceBetweenPoints(player.position, player.clientPosition) > 2) {
        player.phasedUntil = getTime() + 2000
        player.log.phases += 1
        player.log.clientDistanceProblem += 1
      }

      // if (distanceBetweenPoints(player.position, player.clientPosition) > config.checkPositionDistance) {
      //   // Do nothing for now
      //   player.position = moveVectorTowards(player.position, player.clientPosition, player.speed * deltaTime)
      //   player.log.resetPosition += 1
      // } else {
        // if (player.lastReportedTime > )
      let position = moveVectorTowards(player.position, player.clientTarget, (player.overrideSpeed || player.speed) * deltaTime) // castVectorTowards(player.position, player.clientTarget, 9999)
      // let target = castVectorTowards(position, player.clientTarget, 100)

      let outOfBounds = false
      if (position.x > mapBoundary.x.max) {
        position.x = mapBoundary.x.max
        outOfBounds = true
      }
      if (position.x < mapBoundary.x.min) {
        position.x = mapBoundary.x.min
        outOfBounds = true
      }
      if (position.y > mapBoundary.y.max) {
        position.y = mapBoundary.y.max
        outOfBounds = true
      }
      if (position.y < mapBoundary.y.min) {
        position.y = mapBoundary.y.min
        outOfBounds = true
      }

      if (outOfBounds) {
        player.log.outOfBounds += 1
      }

      let collided = false
      let stuck = false

      for (const i in mapData) {
        const gameObject = mapData[i]

        if (!gameObject.Colliders || !gameObject.Colliders.length) continue

        for (const gameCollider of gameObject.Colliders) {
          let collider
          
          if (gameObject.Name.indexOf('Island') === 0) {
            collider = {
              minX: gameCollider.Min[0],
              maxX: gameCollider.Max[0],
              minY: gameCollider.Min[1],
              maxY: gameCollider.Max[1]
            }
          } else {
            collider = {
              minX: gameCollider.Min[0],
              maxX: gameCollider.Max[0],
              minY: gameCollider.Min[1],
              maxY: gameCollider.Max[1]
            }
          }

          if (config.level2open && gameObject.Name === 'Level2Divider') {
            const diff = 25
            collider.minY -= diff
            collider.maxY -= diff
          }

          if (
            position.x >= collider.minX &&
            position.x <= collider.maxX &&
            position.y >= collider.minY &&
            position.y <= collider.maxY
          ) {
            if (gameObject.Name.indexOf('Land') === 0) {
              stuck = true
            }
            else if (gameObject.Name.indexOf('Island') === 0) {
              if (config.stickyIslands) {
                stuck = true
              } else {
                collided = true
              }
            }
            else if (gameObject.Name.indexOf('Collider') === 0) {
              stuck = true
            }
            else if (gameObject.Name.indexOf('Level2Divider') === 0) {
              stuck = true
            }
          }
        }

        if (stuck) break
        if (collided) break
      }

      if (player.isGod) {
        stuck = false
        collided = false
      }

      player.isStuck = false

      if (collided) {
        player.position = position
        player.target = player.clientTarget
        player.phasedUntil = getTime() + 2000
        if (!player.phasedPosition)
          player.phasedPosition = position
        player.log.phases += 1
        player.log.collided += 1
        player.overrideSpeed = 0.5
      } else if (stuck) {
        player.target = player.clientTarget
        player.phasedUntil = getTime() + 2000
        player.log.phases += 1
        player.log.stuck += 1
        player.overrideSpeed = 0.5
        if (config.stickyIslands) {
          player.isStuck = true
        }
      } else {
        player.position = position
        player.target = player.clientTarget //castVectorTowards(position, player.clientTarget, 9999)
        player.overrideSpeed = null
      }

      const pos = Math.round(player.position.x) + ':' + Math.round(player.position.y)
      
      if (player.log.path.indexOf(pos) === -1) {
        // player.log.path += pos + ','
        player.log.positions += 1
      }
    }

    if (config.level2allowed) {
      if (config.level2forced || clients.filter(c => !c.isSpectating && !c.isDead).length >= config.playersRequiredForLevel2) {
        if (!config.level2open) {
          baseConfig.level2open = true
          config.level2open = true

          publishEvent('OnBroadcast', `Wall going down...`, 0)

          setTimeout(() => {
            sharedConfig.spritesStartCount = 200
            config.spritesStartCount = 200
            clearSprites()
            spawnSprites(config.spritesStartCount)
          }, 2 * 1000)

          publishEvent('OnOpenLevel2')
        }
      }

      if (!config.level2forced && clients.filter(c => !c.isSpectating && !c.isDead).length < config.playersRequiredForLevel2 - 7) {
        if (config.level2open) {
          baseConfig.level2open = false
          config.level2open = false

          publishEvent('OnBroadcast', `Wall going up...`, 0)

          sharedConfig.spritesStartCount = 50
          config.spritesStartCount = 50
          clearSprites()
          spawnSprites(config.spritesStartCount)

          setTimeout(() => {
            for (const player of round.players) {
              // if (player.position.x < -18) {
                resetPlayer(player)
              // }
            }
          }, 2 * 1000)

          publishEvent('OnCloseLevel2')
        }
      }
    }

    if (!config.isRoundPaused) {
      // Check kills
      for (let i = 0; i < clients.length; i++) {
        const player1 = clients[i]
        const isPlayer1Invincible = player1.isInvincible ? true : (player1.invincibleUntil > currentTime)
        if (player1.isSpectating) continue
        if (player1.isDead) continue
        if (isPlayer1Invincible) continue

        for (let j = 0; j < clients.length; j++) {
          const player2 = clients[j]
          const isPlayer2Invincible = player2.isInvincible ? true : (player2.invincibleUntil > currentTime)

          if (player1.id === player2.id) continue
          if (player2.isDead) continue
          if (player2.isSpectating) continue
          if (isPlayer2Invincible) continue
          if (player2.avatar === player1.avatar) continue

          // log(player1.position, player2.position, distanceBetweenPoints(player1.position.x, player1.position.y, player2.position.x, player2.position.y))

          const distance = distanceMap[player1.avatar] + distanceMap[player2.avatar] //Math.max(distanceMap[player1.avatar], distanceMap[player2.avatar]) + Math.min(distanceMap[player1.avatar], distanceMap[player2.avatar])

          const position1 = player1.isPhased ? player1.phasedPosition : player1.position
          const position2 = player2.isPhased ? player2.phasedPosition : player2.position

          if (distanceBetweenPoints(position1, position2) > distance) continue

          if (player2.avatar > player1.avatar) {
            // if (distanceBetweenPoints(player2.position, player2.clientPosition) > config.pickupCheckPositionDistance) continue
            // playerDamageGiven[currentPlayer.id + pack.id] = now
            // // log('Player Damage Given', currentPlayer.id + pack.id)
            // if (playerDamageTaken[currentPlayer.id + pack.id] > now - 500) {
              // if (player1.xp > 5) {
                // player1.xp -= 1
              // } else {
                registerKill(app, player2, player1)
              // }
              break
            // }
          } else if (player1.avatar > player2.avatar) {
            // if (distanceBetweenPoints(player1.position, player1.clientPosition) > config.pickupCheckPositionDistance) continue
            // playerDamageGiven[pack.id + currentPlayer.id] = now
            // // log('Player Damage Given', pack.id + currentPlayer.id)
            // if (playerDamageTaken[pack.id + currentPlayer.id] > now - 500) {
              // if (player2.xp > 5) {
              //   player2.xp -= 1
              // } else {
                registerKill(app, player1, player2)
              // }
              break
            // }
          }
        }
      }

      // Check pickups
      for (let i = 0; i < clients.length; i++) {
        const player = clients[i]

        if (player.isDead) continue
        if (player.isSpectating) continue
        if (player.isPhased || now < player.phasedUntil) continue
        // log(player.position, player.clientPosition, distanceBetweenPoints(player.position, player.clientPosition))
        // log(currentReward)
        // if (distanceBetweenPoints(player.position, player.clientPosition) > config.pickupCheckPositionDistance) continue

        const touchDistance = config.pickupDistance + config['avatarTouchDistance' + player.avatar]

        for (const powerup of powerups) {
          if (distanceBetweenPoints(player.position, powerup.position) > touchDistance) continue

          if (config.gameMode === 'Hayai') {
            player.baseSpeed -= 0.001

            if (player.baseSpeed <= 0.5) {
              player.baseSpeed = 0.5
            }
          }

          let value = 0

          if (powerup.type == 0) {
            value = config.powerupXp0

            if (config.gameMode === 'Sprite Juice') {
              player.invincibleUntil = Math.round(getTime() / 1000) + 2
              // publishEvent('OnBroadcast', `Speed up ${player.baseSpeed}`, 0)
            }

            if (config.gameMode === 'Marco Polo') {
              player.cameraSize += 0.05
            }
          }

          if (powerup.type == 1) {
            value = config.powerupXp1
            if (config.gameMode === 'Sprite Juice') {
              player.baseSpeed += 0.05 * 2
              player.decayPower -= 0.1 * 2
              // publishEvent('OnBroadcast', `Speed down ${player.baseSpeed}`, 0)
            }

            if (config.gameMode === 'Marco Polo') {
              player.cameraSize += 0.01
            }
          }

          if (powerup.type == 2) {
            value = config.powerupXp2
            if (config.gameMode === 'Sprite Juice') {
              player.baseSpeed -= 0.05 * 2
              // publishEvent('OnBroadcast', `Decay ${player.decayPower}`, 0)
            }

            if (config.gameMode === 'Marco Polo') {
              player.cameraSize -= 0.01
            }
          }

          if (powerup.type == 3) {
            value = config.powerupXp3
            if (config.gameMode === 'Sprite Juice') {
              player.decayPower += 0.1 * 2
              // publishEvent('OnBroadcast', `Invinc`, 0)
            }

            if (config.gameMode === 'Marco Polo') {
              player.cameraSize -= 0.05
            }
          }

          if (config.gameMode === 'Sprite Juice') {
            if (player.baseSpeed < 0.25) {
              player.baseSpeed = 0.25
            }

            if (player.baseSpeed > 2) {
              player.baseSpeed = 2
            }

            if (player.decayPower < 0.5) {
              player.decayPower = 0.5
            }

            if (player.decayPower > 2) {
              player.decayPower = 8
            }
          }

          if (config.gameMode === 'Marco Polo') {
            if (player.cameraSize < 1.5) {
              player.cameraSize = 1.5
            }

            if (player.cameraSize > 6) {
              player.cameraSize = 6
            }
          }

          player.powerups += 1
          player.points += config.pointsPerPowerup
          player.xp += (value * config.spriteXpMultiplier)
      
          publishEvent('OnUpdatePickup', player.id, powerup.id, value)

          removeSprite(powerup.id)
          spawnSprites(1)
        }

        const currentTime = Math.round(now / 1000)
        const isNew = player.joinedAt >= currentTime - config.immunitySeconds || player.isInvincible

        if (!isNew) {
          for (const orb of orbs) {
            if (!orb) continue
            if (now < orb.enabledAt) continue
            if (distanceBetweenPoints(player.position, orb.position) > touchDistance) continue
      
            player.orbs += 1
            player.points += orb.points
            player.points += config.pointsPerOrb
      
            publishEvent('OnUpdatePickup', player.id, orb.id, 0)
      
            removeOrb(orb.id)

            publishEvent('OnBroadcast', `${player.name} stole an orb (${orb.points})`, 0)
          }
      
          const rewards = [currentReward]

          for (const reward of rewards) {
            if (!reward) continue
            if (now < reward.enabledAt) continue
            // log(distanceBetweenPoints(player.position, reward.position), player.position, reward.position, touchDistance)
            if (distanceBetweenPoints(player.position, reward.position) > touchDistance) continue
      
            // player.rewards += 1
            // player.points += config.pointsPerReward
      
            claimReward(player, reward)
            removeReward()
          }
        }
      }
    }

    lastFastestGameloopTime = now
  } catch (e) {
    log(e)
  }
}

function normalizeFloat(f, num = 2) {
  return parseFloat(f.toFixed(num))
}

function fastGameloop(app) {
  try {
    const now = getTime()

    detectCollisions(app)

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]

      if (client.isDisconnected) continue
      if (client.isDead) continue
      if (client.isSpectating) continue
      if (client.isJoining) continue

      const currentTime = Math.round(now / 1000)
      const isInvincible = config.isGodParty || client.isSpectating || client.isGod || client.isInvincible || (client.invincibleUntil > currentTime)
      const isPhased = client.isPhased ? true : now <= client.phasedUntil

      if (client.isPhased) {
        if (now > client.phasedUntil) {
          client.phasedUntil = 0
          client.isPhased = false
        }
      }

      client.speed = getClientSpeed(client, config)

      // console.log('speed', client.name, client.avatar, client.speed)

      if (!config.isRoundPaused && config.gameMode !== 'Pandamonium') {
        let decay = config.noDecay ? 0 : ((client.avatar + 1) / (1 / config.fastLoopSeconds) * ((config['avatarDecayPower' + client.avatar] || 1) * config.decayPower)) * (1 + (client.character.meta[1105] - client.character.meta[1104])/100)
  
        if (client.xp > 100) {
          if (decay > 0) {
            if (client.avatar < (config.maxEvolves - 1)) {
              client.xp = client.xp - 100
              client.avatar = Math.max(Math.min(client.avatar + (1 * config.avatarDirection), config.maxEvolves - 1), 0)
              client.evolves += 1
              client.points += config.pointsPerEvolve
      
              if (config.leadercap && client.name === lastLeaderName) {
                client.speed = client.speed * 0.8
              }
      
              publishEvent('OnUpdateEvolution', client.id, client.avatar, client.speed)
            } else {
              client.xp = 100
            }
          } else {
            if (client.avatar >= (config.maxEvolves - 1)) {
              client.xp = 100
              // const currentTime = Math.round(now / 1000)
              // const isNew = client.joinedAt >= currentTime - config.immunitySeconds
                
              // if (!config.noBoot && !isInvincible && !isNew) {
              //   disconnectPlayer(client)
              // }
            } else {
              client.xp = client.xp - 100
              client.avatar = Math.max(Math.min(client.avatar + (1 * config.avatarDirection), config.maxEvolves - 1), 0)
              client.evolves += 1
              client.points += config.pointsPerEvolve
      
              if (config.leadercap && client.name === lastLeaderName) {
                client.speed = client.speed * 0.8
              }
      
              publishEvent('OnUpdateEvolution', client.id, client.avatar, client.speed)
            }
          }
        } else {
          if (!isInvincible) {
            client.xp -= decay * client.decayPower
          }
  
          if (client.xp <= 0) {
            client.xp = 0
  
            if (decay > 0) {
              if (client.avatar === 0) {
                const currentTime = Math.round(now / 1000)
                const isNew = client.joinedAt >= currentTime - config.immunitySeconds
                  
                if (!config.noBoot && !isInvincible && !isNew && !config.isGodParty) {
                  client.log.ranOutOfHealth += 1
                  disconnectPlayer(app, client, 'starved')
                }
              } else {
                client.xp = 100
                client.avatar = Math.max(Math.min(client.avatar - (1 * config.avatarDirection), config.maxEvolves - 1), 0)
  
                if (config.leadercap && client.name === lastLeaderName) {
                  client.speed = client.speed * 0.8
                }
        
                publishEvent('OnUpdateRegression', client.id, client.avatar, client.speed)
              }
            } else {
              if (client.avatar === 0) {
                client.xp = 0
              } else {
                client.xp = 100
                client.avatar = Math.max(Math.min(client.avatar - (1 * config.avatarDirection), config.maxEvolves - 1), 0)
  
                if (config.leadercap && client.name === lastLeaderName) {
                  client.speed = client.speed * 0.8
                }
        
                publishEvent('OnUpdateRegression', client.id, client.avatar, client.speed)
              }
            }
          }
        }
      }

      client.latency = ((now - client.lastReportedTime) / 2)// - (now - lastFastGameloopTime)

      if (Number.isNaN(client.latency)) {
        client.latency = 0
      }
  
      if (config.gameMode === 'Pandamonium' && pandas.includes(client.address)) {
        client.avatar = 2
      }

      publishEvent('OnUpdatePlayer',
        client.id, 
        client.overrideSpeed || client.speed, 
        client.overrideCameraSize || client.cameraSize, 
        client.position.x, 
        client.position.y, 
        client.position.x, // target
        client.position.y, // target
        Math.floor(client.xp), 
        now, 
        Math.round(client.latency), 
        isInvincible ? '1' : '0', 
        client.isStuck ? '1' : '0', 
        isPhased && !isInvincible ? '1' : '0'
       )
    }

    flushEventQueue(app)

    if (config.gameMode === 'Hayai') {
      const timeStep = ((5*60)*(config.fastLoopSeconds * 1000)) // +5 base speed total, timestepped
      const speedMultiplier = 0.25

      config.baseSpeed += normalizeFloat((5*speedMultiplier) / timeStep)

      // sharedConfig.checkPositionDistance += Math.round(6 / timeStep)
      config.checkPositionDistance += normalizeFloat((6*speedMultiplier) / timeStep)
      
      // sharedConfig.checkInterval += Math.round(3 / timeStep)
      config.checkInterval += normalizeFloat((3*speedMultiplier) / timeStep)
    }


    let totalAlivePlayers = []

    for (let i = 0; i < clients.length; i++) {
      if (!clients[i].isGod && !clients[i].isSpectating && !clients[i].isDead) {
        totalAlivePlayers.push(clients[i])
      }
    }

    if (config.isBattleRoyale && totalAlivePlayers.length === 1) {
      publishEvent('OnBroadcast', `${totalAlivePlayers[0].name} is the last dragon standing`, 3)

      baseConfig.isBattleRoyale = false
      config.isBattleRoyale = false
      baseConfig.isGodParty = true
      config.isGodParty = true
    }

    lastFastGameloopTime = now
  } catch(e) {
    log('Error:', e)

    disconnectAllPlayers(app)

    setTimeout(function() {
      process.exit(1)
    }, 2 * 1000)

    return
  }

  setTimeout(() => fastGameloop(app), config.fastLoopSeconds * 1000)
}

function getGameModeGuide(config) {
  return config.guide || [
    'Game Mode - ' + config.gameMode,
    '1. Eat sprites to stay alive',
    '2. Avoid bigger dragons',
    '3. Eat smaller dragons'
  ]
}

let eventFlushedAt = getTime()

function flushEventQueue(app) {
  const now = getTime()

  if (eventQueue.length) {
    if (debugQueue) log('Sending queue', eventQueue)

    let recordDetailed = now - eventFlushedAt > 500

    if (recordDetailed) {
      eventFlushedAt = now
    }

    const compiled = []
    for (const e of eventQueue) {
      const name = e[0]
      const args = e.slice(1)

      compiled.push(`["${name}","${args.join(':')}"]`)

      if (name == 'OnUpdatePlayer' || name == 'OnSpawnPowerup') {
        if (recordDetailed) {
          round.events.push({ type: 'emitAll', name, args })
        }
      } else {
        round.events.push({ type: 'emitAll', name, args })
      }
    }

    emitAll(app, 'Events', getPayload(compiled))

    // round.events = round.events.concat(eventQueue)
  
    eventQueue = null
    eventQueue = []
  }
}

function clearSprites() {
  powerups.splice(0, powerups.length) // clear the powerup list
}

function initEventHandler(app) {
  log('Starting event handler')

  app.io.on('connection', function(socket) {
    try {
      const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.conn.remoteAddress?.split(":")[3]
      // socket.request.connection.remoteAddress ::ffff:127.0.0.1
      // socket.conn.remoteAddress ::ffff:127.0.0.1
      // socket.conn.transport.socket._socket.remoteAddress ::ffff:127.0.0.1
      let hash = ip ? sha256(ip.slice(ip.length/2)) : ''
      hash = ip ? hash.slice(hash.length - 10, hash.length - 1) : ''

      const spawnPoint = playerSpawnPoints[(Math.floor(Math.random() * playerSpawnPoints.length))]

      let currentPlayer = {
        name: 'Unknown' + Math.floor(Math.random() * 999),
        id: socket.id,
        avatar: null,
        network: null,
        address: null,
        device: null,
        position: spawnPoint,
        target: spawnPoint,
        clientPosition: spawnPoint,
        clientTarget: spawnPoint,
        rotation: null,
        xp: 50,
        latency: 0,
        kills: 0,
        deaths: 0,
        points: 0,
        evolves: 0,
        powerups: 0,
        rewards: 0,
        orbs: 0,
        pickups: [],
        isMod: false,
        isBanned: false,
        isMasterClient: false,
        isDisconnected: false,
        isDead: true,
        isJoining: false,
        isSpectating: false,
        isStuck: false,
        isGod: false,
        isRealm: false,
        isInvincible: config.isGodParty ? true : false,
        isPhased: false,
        overrideSpeed: null,
        overrideCameraSize: null,
        cameraSize: config.cameraSize,
        speed: config.baseSpeed * config.avatarSpeedMultiplier0,
        joinedAt: 0,
        invincibleUntil: 0,
        decayPower: 1,
        hash,
        lastReportedTime: getTime(),
        lastUpdate: 0,
        gameMode: config.gameMode,
        phasedUntil: getTime(),
        joinedRoundAt: getTime(),
        baseSpeed: 1,
        character: {
          meta: {
            [ItemAttributes.EvolutionMovementSpeedIncrease.id]: 0,
            1104: 0,
            1105: 0,
            // MaximumHealthIncrease: 0,
            // DeathPenaltyDecrease: 0,
            // DeathPenaltyAvoid: 0,
            // EnergyDecayDecrease: 0,
            // EnergyDecayIncrease: 0,
            // OrbTimeReduce: 0,
            // WinRewardsDecrease: 0,
            // DoublePickupChance: 0,
            // LeaderMovementSpeedDecrease: 0,
            // IncreaseMovementSpeedOnKill: 0
          }
        },
        log: {
          kills: [],
          deaths: [],
          revenge: 0,
          resetPosition: 0,
          phases: 0,
          stuck: 0,
          collided: 0,
          timeoutDisconnect: 0,
          speedProblem: 0,
          clientDistanceProblem: 0,
          outOfBounds: 0,
          ranOutOfHealth: 0,
          notReallyTrying: 0,
          tooManyKills: 0,
          killingThemselves: 0,
          sameNetworkDisconnect: 0,
          connectedTooSoon: 0,
          clientDisconnected: 0,
          positionJump: 0,
          pauses: 0,
          connects: 0,
          path: '',
          positions: 0,
          replay: [],
          recentJoinProblem: 0,
          usernameProblem: 0,
          maintenanceJoin: 0,
          signatureProblem: 0,
          signinProblem: 0,
          versionProblem: 0,
          failedRealmCheck: 0,
        }
      }

      log('User connected from hash ' + hash)

      if (!testMode && killSameNetworkClients) {
        // const sameNetworkClients = clients.filter(r => r.hash === currentPlayer.hash && r.id !== currentPlayer.id)

        // for (const client of sameNetworkClients) {
        //   client.log.sameNetworkDisconnect += 1
        //   disconnectPlayer(app, client, 'same network')
        // }
        const sameNetworkClient = clients.find(r => r.hash === currentPlayer.hash && r.id !== currentPlayer.id)

        if (sameNetworkClient) {
          currentPlayer.log.sameNetworkDisconnect += 1
          disconnectPlayer(app, currentPlayer, 'same network')
          return
        }
      }

      sockets[currentPlayer.id] = socket
      clientLookup[currentPlayer.id] = currentPlayer

      if (Object.keys(clientLookup).length == 1) {
        currentPlayer.isMasterClient = true // first client to join the game
      }

      clients = clients.filter(c => c.hash !== currentPlayer.hash) // if we allow same network, this needs to be fixed
      clients.push(currentPlayer)

      socket.on('RS_Connected', async function(req) {
        log('RS_Connected', req)

        try {
          // Assume first connection for now but verify
          realmServer.socket = socket

          if (!await isValidAdminRequest(req)) throw new Error('Not admin')

          const sameNetworkObservers = observers.filter(r => r.hash === currentPlayer.hash)

          for (const observer of sameNetworkObservers) {
            disconnectPlayer(app, observer, 'same network observer')
          }

          const observer = {
            socket
          }

          observers.push(observer)

          // TODO: confirm it's the realm server
          realmServer.socket = socket
          currentPlayer.isRealm = true

          socket.emit('RS_ConnectedResponse', {
            id: req.id,
            data: { status: 1 }
          })

          const initRes = await rsCall('GS_InitRequest', { status: 1 }) as any

          log('GS_InitRequest', initRes)

          if (initRes?.status === 1) {
            baseConfig.id = initRes.id
            config.id = initRes.id
            baseConfig.roundId = initRes.data.roundId
            config.roundId = initRes.data.roundId
          } else {
            log('Error:', 'Could not init')
          }
        } catch (e) {
          log('Error:', e)

          realmServer.socket = undefined

          socket.emit('RS_ConnectedResponse', {
            id: req.id,
            data: { status: 0 }
          })

          await rsCall('GS_InitRequest', { status: 0 })
        }
      })

      socket.on('RS_ApiConnected', async function(req) {
        log('RS_ApiConnected', req)

        if (!await isValidAdminRequest(req)) {
          socket.emit('RS_ApiConnectedResponse', {
            id: req.id,
            data: { status: 0 }
          }) 
          return
        }
      
        publishEvent('OnBroadcast', `API connected`, 0)

        socket.emit('RS_ApiConnectedResponse', {
          id: req.id,
          data: { status: 1 }
        })
      })

      socket.on('RS_ApiDisconnected', async function(req) {
        log('RS_ApiDisconnected', req)

        if (!await isValidAdminRequest(req)) {
          socket.emit('RS_ApiDisconnectedResponse', {
            id: req.id,
            data: { status: 0 }
          }) 
          return
        }

        publishEvent('OnBroadcast', `API disconnected`, 0)

        socket.emit('RS_ApiDisconnectedResponse', {
          id: req.id,
          data: { status: 1 }
        })
      })

      socket.on('RS_SetPlayerCharacterRequest', async function(req) {
        log('RS_SetPlayerCharacterRequest', req, req.data.character.meta)

        try {
          if (currentPlayer.isRealm) {
            const client = clients.find(c => c.address === req.data.address)

            if (client) {
              client.character = {
                ...req.data.character,
                meta: {
                  ...client.character.meta,
                  ...req.data.character.meta
                }
              }

              emitDirect(sockets[currentPlayer.id], 'OnBroadcast', `${client.character.meta[ItemAttributes.EvolutionMovementSpeedIncrease.id]}% Increased Speed`, 0)

              socket.emit('RS_SetPlayerCharacterResponse', {
                id: req.id,
                data: { status: 1 }
              })

              return
            }
          }
        } catch (e) {
          log('Error:', e)
        }

        socket.emit('RS_SetPlayerCharacterResponse', {
          id: req.id,
          data: { status: 0 }
        })
      })

      socket.on('RS_SetConfigRequest', async function(req) {
        log('RS_SetConfigRequest', req)

        try {
          if (await isValidAdminRequest(req)) {
            const originalRewardAmount = config.rewardWinnerAmount

            for (const key of Object.keys(req.data.config)) {
              const value = req.data.config[key]

              const val = value === "true" ? true : (value === "false" ? false : (isNumeric(value) ? parseFloat(value) : value))
              if (baseConfig.hasOwnProperty(key)) 
                baseConfig[key] = val
  
              if (sharedConfig.hasOwnProperty(key))
                sharedConfig[key] = val
  
              config[key] = val

              if (!req.data.isReset) publishEvent('OnBroadcast', `${key} = ${val}`, 1)
            }

            if (originalRewardAmount === 0 && config.rewardWinnerAmount !== 0) {
              const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
              publishEvent('OnSetRoundInfo', roundTimer + ':' + getRoundInfo().join(':') + ':' + getGameModeGuide(config).join(':'))
            }

            socket.emit('RS_SetConfigResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_SetConfigResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)

          socket.emit('RS_SetConfigResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_GetConfigRequest', function(req) {
        log('RS_GetConfigRequest', req)

        socket.emit('RS_GetConfigResponse', {
          id: req.id,
          data: {
            status: 1,
            data: config
          }
        })
      })

      socket.on('Load', function() {
        log('Load', currentPlayer.hash)

        emitDirect(socket, 'OnLoaded', 1)
      })

      socket.on('Spectate', function() {
        log('Spectate', currentPlayer.address)

        spectate(currentPlayer)
      })
      
      socket.on('SetInfo', async function(msg) {
        log('SetInfo', msg)

        try {
          const pack = decodePayload(msg)

          if (!pack.signature || !pack.network || !pack.device || !pack.address) {
            currentPlayer.log.signinProblem += 1
            disconnectPlayer(app, currentPlayer, 'signin problem')
            return
          }

          // if (semver.diff(serverVersion, pack.version) !== 'patch') {
          //   currentPlayer.log.versionProblem += 1
          //   disconnectPlayer(app, currentPlayer)
          //   return
          // }

          const address = await normalizeAddress(pack.address)

          log('SetInfo normalizeAddress', pack.address, address)

          if (!await isValidSignatureRequest({ signature: { data: 'evolution', hash: pack.signature.trim(), address } })) {
            currentPlayer.log.signatureProblem += 1
            disconnectPlayer(app, currentPlayer, 'signature problem')
            return
          }

          if (currentPlayer.isBanned) {
            emitDirect(socket, 'OnBanned', true)
            disconnectPlayer(app, currentPlayer, 'banned')
            return
          }

          if (config.isMaintenance && !currentPlayer.isMod) {
            currentPlayer.log.maintenanceJoin += 1
            emitDirect(socket, 'OnMaintenance', true)
            disconnectPlayer(app, currentPlayer, 'maintenance')
            return
          }

          let name = addressToUsername[address]

          if (!name || name.indexOf('Guest') === 0) {
            name = await getUsername(address)

            if (!name) {
              currentPlayer.log.usernameProblem += 1
              disconnectPlayer(app, currentPlayer, 'no name')
              return
            }

            addressToUsername[address] = name
          }

          if (['Testman', 'join'].includes(name)) {
            currentPlayer.isGod = true
            currentPlayer.overrideCameraSize = 12
          }

          log('User ' + name + ' with address ' + address + ' with hash ' + hash)

          const now = getTime()
          if (currentPlayer.name !== name || currentPlayer.address !== address) {
            currentPlayer.name = name
            currentPlayer.address = address
            currentPlayer.network = pack.network
            currentPlayer.device = pack.device

            const recentPlayer = round.players.find(r => r.address === address)

            if (recentPlayer) {
              if ((now - recentPlayer.lastUpdate) < 3000) {
                currentPlayer.log.recentJoinProblem += 1
                disconnectPlayer(app, currentPlayer, 'joined too soon', true)
                return
              }

              currentPlayer.pickups = recentPlayer.pickups
              currentPlayer.kills = recentPlayer.kills
              currentPlayer.deaths = recentPlayer.deaths
              currentPlayer.points = recentPlayer.points
              currentPlayer.evolves = recentPlayer.evolves
              currentPlayer.powerups = recentPlayer.powerups
              currentPlayer.rewards = recentPlayer.rewards
              currentPlayer.lastUpdate = recentPlayer.lastUpdate
              currentPlayer.log = recentPlayer.log
              currentPlayer.joinedRoundAt = recentPlayer.joinedRoundAt
              currentPlayer.character = recentPlayer.character

              currentPlayer.log.connects += 1
            }
        
            publishEvent('OnSetInfo', currentPlayer.id, currentPlayer.name, currentPlayer.network, currentPlayer.address, currentPlayer.device)

            if (config.log.connections) {
              log('Connected', {
                hash,
                address: currentPlayer.address,
                name: currentPlayer.name
              })
            }
          }
        } catch(e) {
          log('Error:', e)
        }
      })

      socket.on('JoinRoom', async function() {
        log('JoinRoom', currentPlayer.id, currentPlayer.hash)

        try {
          const confirmUser = await rsCall('GS_ConfirmUserRequest', { address: currentPlayer.address }) as any

          if (confirmUser?.status !== 1) {
            currentPlayer.log.failedRealmCheck += 1
            disconnectPlayer(app, currentPlayer, 'failed realm check')
            return
          }

          // const pack = decodePayload(msg)
          const now = getTime()
          const recentPlayer = round.players.find(r => r.address === currentPlayer.address)

          if (recentPlayer && (now - recentPlayer.lastUpdate) < 3000) {
            currentPlayer.log.connectedTooSoon += 1
            disconnectPlayer(app, currentPlayer, 'connected too soon')
            return
          }

          if (config.isMaintenance && !currentPlayer.isMod) {
            emitDirect(socket, 'OnMaintenance', true)
            disconnectPlayer(app, currentPlayer, 'maintenance')
            return
          }

          currentPlayer.isJoining = true
          currentPlayer.avatar = config.startAvatar
          currentPlayer.speed = getClientSpeed(currentPlayer, config)

          if (config.gameMode === 'Pandamonium' && pandas.includes(currentPlayer.address)) {
            currentPlayer.avatar = 2
            emitDirect(socket, 'OnUpdateEvolution', currentPlayer.id, currentPlayer.avatar, currentPlayer.speed)
          }
          
          log("[INFO] player " + currentPlayer.id + ": logged!")
          log("[INFO] Total players: " + Object.keys(clientLookup).length)

          const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
          emitDirect(socket, 'OnSetPositionMonitor', Math.round(config.checkPositionDistance) + ':' + Math.round(config.checkInterval) + ':' + Math.round(config.resetInterval))
          emitDirect(socket, 'OnJoinGame', currentPlayer.id, currentPlayer.name, currentPlayer.avatar, currentPlayer.isMasterClient ? 'true' : 'false', roundTimer, currentPlayer.position.x, currentPlayer.position.y)
          // emitDirect(socket, 'OnSetInfo', currentPlayer.id, currentPlayer.name, currentPlayer.address, currentPlayer.network, currentPlayer.device)

          if (observers.length === 0) {
            emitDirect(socket, 'OnBroadcast', `Realm not connected. Contact support.`, 0)
            disconnectPlayer(app, currentPlayer, 'realm not connected')
            return
          }

          if (!config.isRoundPaused) {
            emitDirect(socket, 'OnSetRoundInfo', roundTimer + ':' + getRoundInfo().join(':') + ':' + getGameModeGuide(config).join(':'))
            emitDirect(socket, 'OnBroadcast', `Game Mode - ${config.gameMode} (Round ${config.roundId})`, 0)
          }

          syncSprites()

          if (config.hideMap) {
            emitDirect(socket, 'OnHideMinimap')
            emitDirect(socket, 'OnBroadcast', `Minimap hidden in this mode!`, 2)
          }

          if (config.level2open) {
            emitDirect(socket, 'OnOpenLevel2')
            emitDirect(socket, 'OnBroadcast', `Wall going down!`, 0)
          } else {
            emitDirect(socket, 'OnCloseLevel2')
          }


          if (currentPlayer.character.meta[ItemAttributes.EvolutionMovementSpeedIncrease.id] > 0)
            emitDirect(sockets[currentPlayer.id], 'OnBroadcast', `${currentPlayer.character.meta[ItemAttributes.EvolutionMovementSpeedIncrease.id]}% Increased Speed`, 0)

          // spawn all connected clients for currentUser client 
          for (const client of clients) {
            if (client.id === currentPlayer.id) continue
            if (client.isDisconnected || client.isDead || client.isSpectating || client.isJoining) continue

            emitDirect(socket, 'OnSpawnPlayer', client.id, client.name, client.speed, client.avatar, client.position.x, client.position.y, client.position.x, client.position.y)
          }

          for (let c = 0; c < powerups.length; c++) {
            emitDirect(socket, 'OnSpawnPowerUp', powerups[c].id, powerups[c].type, powerups[c].position.x, powerups[c].position.y, powerups[c].scale) // spawn power up in unity scene
          }

          for (let c = 0; c < orbs.length; c++) {
            emitDirect(socket, 'OnSpawnPowerUp', orbs[c].id, orbs[c].type, orbs[c].position.x, orbs[c].position.y, orbs[c].scale) // spawn power up in unity scene
          }

          if (currentReward) {
            emitDirect(socket, 'OnSpawnReward', currentReward.id, currentReward.rewardItemType, currentReward.rewardItemName, currentReward.quantity, currentReward.position.x, currentReward.position.y)
          }

          currentPlayer.lastUpdate = getTime()
        } catch (e) {
          log('Error:', e)
          disconnectPlayer(app, currentPlayer, 'not sure: ' + e)
        }
      })

      socket.on('UpdateMyself', function(msg) {
        try {
          if (currentPlayer.isDead && !currentPlayer.isJoining) return
          if (currentPlayer.isSpectating) return

          if (config.isMaintenance && !currentPlayer.isMod) {
            emitDirect(socket, 'OnMaintenance', true)
            disconnectPlayer(app, currentPlayer, 'maintenance')
            return
          }

          const now = getTime()

          if (now - currentPlayer.lastUpdate < config.forcedLatency) return
          if (currentPlayer.name === 'Testman' && now - currentPlayer.lastUpdate < 200) return // Force testman to 120ms

          if (currentPlayer.isJoining) {
            currentPlayer.isDead = false
            currentPlayer.isJoining = false
            currentPlayer.joinedAt = Math.round(getTime() / 1000)
            currentPlayer.invincibleUntil = currentPlayer.joinedAt + config.immunitySeconds

            if (config.isBattleRoyale) {
              emitDirect(socket, 'OnBroadcast', 'Spectate until the round is over', 0)
              spectate(currentPlayer)
              return
            }

            addToRecentPlayers(currentPlayer)

            // spawn currentPlayer client on clients in broadcast
            publishEvent('OnSpawnPlayer', currentPlayer.id, currentPlayer.name, currentPlayer.speed, currentPlayer.avatar, currentPlayer.position.x, currentPlayer.position.y, currentPlayer.position.x, currentPlayer.position.y)
    
            if (config.isRoundPaused) {
              emitDirect(socket, 'OnRoundPaused')
              return
            }
          }

          const pack = decodePayload(msg)

          const positionX = parseFloat(parseFloat(pack.position.split(':')[0].replace(',', '.')).toFixed(3))
          const positionY = parseFloat(parseFloat(pack.position.split(':')[1].replace(',', '.')).toFixed(3))

          const targetX = parseFloat(parseFloat(pack.target.split(':')[0].replace(',', '.')).toFixed(3))
          const targetY = parseFloat(parseFloat(pack.target.split(':')[1].replace(',', '.')).toFixed(3))

          if (!Number.isFinite(positionX) || !Number.isFinite(positionY) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return
          if (positionX < mapBoundary.x.min) return
          if (positionX > mapBoundary.x.max) return
          if (positionY < mapBoundary.y.min) return
          if (positionY > mapBoundary.y.max) return
        
          if (config.anticheat.disconnectPositionJumps && distanceBetweenPoints(currentPlayer.position, { x: positionY, y: positionY }) > 5) {
            currentPlayer.log.positionJump += 1
            disconnectPlayer(app, currentPlayer, 'position jumped')
            return
          }

          currentPlayer.clientPosition = { x: normalizeFloat(positionX, 4), y: normalizeFloat(positionY, 4) }
          currentPlayer.clientTarget = { x: normalizeFloat(targetX, 4), y: normalizeFloat(targetY, 4) }
          currentPlayer.lastReportedTime = currentPlayer.name === 'Testman' ? parseFloat(pack.time) - 300 : parseFloat(pack.time)
          currentPlayer.lastUpdate = now
        } catch(e) {
          log('Error:', e)
        }
      })

      socket.on('RS_MaintenanceRequest', async function(req) {
        try {
          log('RS_MaintenanceRequest', req)

          if (await isValidAdminRequest(req)) {
            sharedConfig.isMaintenance = true
            config.isMaintenance = true
        
            publishEvent('OnMaintenance', config.isMaintenance)

            socket.emit('RS_MaintenanceResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_MaintenanceResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_MaintenanceResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_UnmaintenanceRequest', async function(req) {
        try {
          log('RS_UnmaintenanceRequest', req)

          if (await isValidAdminRequest(req)) {
            sharedConfig.isMaintenance = false
            config.isMaintenance = false
        
            publishEvent('OnUnmaintenance', config.isMaintenance)

            socket.emit('RS_UnmaintenanceResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_UnmaintenanceResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_UnmaintenanceResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_StartBattleRoyaleRequest', async function(req) {
        try {
          log('RS_StartBattleRoyaleRequest', req)

          if (await isValidAdminRequest(req)) {

            publishEvent('OnBroadcast', `Battle Royale in 3...`, 1)

            setTimeout(() => {
              publishEvent('OnBroadcast', `Battle Royale in 2...`, 1)

              setTimeout(() => {
                publishEvent('OnBroadcast', `Battle Royale in 1...`, 1)
  
                setTimeout(() => {
                  baseConfig.isBattleRoyale = true
                  config.isBattleRoyale = true

                  baseConfig.isGodParty = false
                  config.isGodParty = false
      
                  publishEvent('OnBroadcast', `Battle Royale Started`, 3)
                  publishEvent('OnBroadcast', `God Party Stopped`, 3)
                }, 1000)
              }, 1000)
            }, 1000)

            socket.emit('RS_StartBattleRoyaleResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_StartBattleRoyaleResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_StartBattleRoyaleResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_StopBattleRoyaleRequest', async function(req) {
        try {
          log('RS_StopBattleRoyaleRequest', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.isBattleRoyale = false
            config.isBattleRoyale = false

            publishEvent('OnBroadcast', `Battle Royale Stopped`, 0)
        
            socket.emit('RS_StopBattleRoyaleResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_StopBattleRoyaleResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_StopBattleRoyaleResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_PauseRoundRequest', async function(req) {
        try {
          log('RS_PauseRoundRequest', req)

          if (await isValidAdminRequest(req)) {
            clearTimeout(roundLoopTimeout)

            baseConfig.isRoundPaused = true
            config.isRoundPaused = true

            publishEvent('OnRoundPaused')
            publishEvent('OnBroadcast', `Round Paused`, 0)
        
            socket.emit('RS_PauseRoundResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_PauseRoundResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_PauseRoundResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_StartRoundRequest', async function(req) {
        try {
          log('RS_StartRoundRequest', req)

          if (await isValidAdminRequest(req)) {
            clearTimeout(roundLoopTimeout)

            if (config.isRoundPaused) {
              baseConfig.isRoundPaused = false
              config.isRoundPaused = false
            }

            resetLeaderboard(presets.find(p => p.gameMode === req.data.gameMode))

            socket.emit('RS_StartRoundResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_StartRoundResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)

          socket.emit('RS_StartRoundResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_EnableForceLevel2Request', async function(req) {
        try {
          log('RS_EnableForceLevel2Request', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.level2forced = true
            config.level2forced = true
            
            socket.emit('RS_EnableForceLevel2Response', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_EnableForceLevel2Response', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)

          socket.emit('RS_EnableForceLevel2Response', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_DisableForceLevel2Request', async function(req) {
        try {
          log('RS_DisableForceLevel2Request', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.level2forced = false
            config.level2forced = false
            
            socket.emit('RS_DisableForceLevel2Response', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_DisableForceLevel2Response', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)

          socket.emit('RS_DisableForceLevel2Response', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_StartGodPartyRequest', async function(req) {
        try {
          log('RS_StartGodPartyRequest', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.isGodParty = true
            config.isGodParty = true

            publishEvent('OnBroadcast', `God Party Started`, 0)
            
            socket.emit('RS_StartGodPartyResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_StartGodPartyResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_StartGodPartyResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_StopGodPartyRequest', async function(req) {
        try {
          log('RS_StopGodPartyRequest', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.isGodParty = false
            config.isGodParty = false

            for (let i = 0; i < clients.length; i++) {
              const player = clients[i]

              player.isInvincible = false
            }

            publishEvent('OnBroadcast', `God Party Stopped`, 2)
            
            socket.emit('RS_StopGodPartyResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_StopGodPartyResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_StopGodPartyResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_StartRuneRoyaleRequest', async function(req) {
        try {
          log('RS_StartRuneRoyaleRequest', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.isRuneRoyale = true
            config.isRuneRoyale = true

            publishEvent('OnBroadcast', `Rune Royale Started`, 0)
            
            socket.emit('RS_StartRuneRoyaleResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_StartRuneRoyaleResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_StartRuneRoyaleResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_PauseRuneRoyaleRequest', async function(req) {
        try {
          log('RS_PauseRuneRoyaleRequest', req)

          if (await isValidAdminRequest(req)) {
            publishEvent('OnBroadcast', `Rune Royale Paused`, 2)
            
            socket.emit('RS_PauseRuneRoyaleResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_PauseRuneRoyaleResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_PauseRuneRoyaleResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_UnpauseRuneRoyaleRequest', async function(req) {
        try {
          log('RS_UnpauseRuneRoyaleRequest', req)

          if (await isValidAdminRequest(req)) {
            publishEvent('OnBroadcast', `Rune Royale Unpaused`, 2)
            
            socket.emit('RS_UnpauseRuneRoyaleResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_UnpauseRuneRoyaleResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_UnpauseRuneRoyaleResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_StopRuneRoyaleRequest', async function(req) {
        try {
          log('RS_StopRuneRoyaleRequest', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.isRuneRoyale = false
            config.isRuneRoyale = false

            publishEvent('OnBroadcast', `Rune Royale Stopped`, 2)
            
            socket.emit('RS_StopRuneRoyaleResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_StopRuneRoyaleResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_StopRuneRoyaleResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_MakeBattleHarderRequest', async function(req) {
        try {
          log('RS_MakeBattleHarderRequest', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.dynamicDecayPower = false
            config.dynamicDecayPower = false

            sharedConfig.decayPower += 2
            config.decayPower += 2

            sharedConfig.baseSpeed += 1
            config.baseSpeed += 1

            sharedConfig.checkPositionDistance += 1
            config.checkPositionDistance += 1
            
            sharedConfig.checkInterval += 1
            config.checkInterval += 1
            
            sharedConfig.spritesStartCount -= 10
            config.spritesStartCount -= 10

            publishEvent('OnSetPositionMonitor', config.checkPositionDistance + ':' + config.checkInterval + ':' + config.resetInterval)
            publishEvent('OnBroadcast', `Difficulty Increased!`, 2)

            syncSprites()
            
            socket.emit('RS_MakeBattleHarderResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_MakeBattleHarderResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_MakeBattleHarderResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_MakeBattleEasierRequest', async function(req) {
        try {
          log('RS_MakeBattleEasierRequest', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.dynamicDecayPower = false
            config.dynamicDecayPower = false

            sharedConfig.decayPower -= 2
            config.decayPower -= 2

            sharedConfig.baseSpeed -= 1
            config.baseSpeed -= 1

            sharedConfig.checkPositionDistance -= 1
            config.checkPositionDistance -= 1
            
            sharedConfig.checkInterval -= 1
            config.checkInterval -= 1
            
            sharedConfig.spritesStartCount += 10
            config.spritesStartCount += 10

            publishEvent('OnSetPositionMonitor', config.checkPositionDistance + ':' + config.checkInterval + ':' + config.resetInterval)
            publishEvent('OnBroadcast', `Difficulty Decreased!`, 0)

            syncSprites()
        
            socket.emit('RS_MakeBattleEasierResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_MakeBattleEasierResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          socket.emit('RS_MakeBattleEasierResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_ResetBattleDifficultyRequest', async function(req) {
        try {
          log('RS_ResetBattleDifficultyRequest', req)

          if (await isValidAdminRequest(req)) {
            baseConfig.dynamicDecayPower = true
            config.dynamicDecayPower = true

            sharedConfig.decayPower = 1.4
            config.decayPower = 1.4

            sharedConfig.baseSpeed = 3
            config.baseSpeed = 3

            sharedConfig.checkPositionDistance = 2
            config.checkPositionDistance = 2
            
            sharedConfig.checkInterval = 1
            config.checkInterval = 1

            publishEvent('OnSetPositionMonitor', config.checkPositionDistance + ':' + config.checkInterval + ':' + config.resetInterval)
            publishEvent('OnBroadcast', `Difficulty Reset!`, 0)
        
            socket.emit('RS_ResetBattleDifficultyResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_ResetBattleDifficultyResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          socket.emit('RS_ResetBattleDifficultyResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      // socket.on('RS_SetConfigRequest', async function(req) {
      //   try {
      //     log('RS_SetConfigRequest', req)

      //     if (await isValidAdminRequest(req)) {
      //       const val = isNumeric(req.data.value) ? parseFloat(req.data.value) : req.data.value
      //       if (baseConfig.hasOwnProperty(req.data.key)) 
      //         baseConfig[req.data.key] = val

      //       if (sharedConfig.hasOwnProperty(req.data.key)) 
      //         sharedConfig[req.data.key] = val

      //       config[req.data.key] = val

      //       publishEvent('OnBroadcast', `${req.data.key} = ${val}`, 1)
            
      //       socket.emit('RS_SetConfigResponse', {
      //         id: req.id,
      //         data: { status: 1 }
      //       })
      //     } else {
      //       socket.emit('RS_SetConfigResponse', {
      //         id: req.id,
      //         data: { status: 0 }
      //       })
      //     }
      //   } catch (e) {
      //     log('Error:', e)
          
      //     socket.emit('RS_SetConfigResponse', {
      //       id: req.id,
      //       data: { status: 0 }
      //     })
      //   }
      // })

      socket.on('RS_MessageUserRequest', async function(req) {
        try {
          log('RS_MessageUserRequest', req)

          if (await isValidAdminRequest(req)) {
            const socket = sockets[clients.find(c => c.address === req.data.target).id]

            emitDirect(socket, 'OnBroadcast', req.data.message.replace(/:/gi, ''), 0)
            
            socket.emit('RS_MessageUserResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_MessageUserResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          socket.emit('RS_MessageUserResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_ChangeUserRequest', async function(req) {
        try {
          log('RS_ChangeUserRequest', req)

          if (await isValidAdminRequest(req)) {
            const client = clients.find(c => c.address === req.data.target)

            for (const key of Object.keys(req.data.config)) {
              const value = req.data.config[key]
              const val = value === "true" ? true : (value === "false" ? false : (isNumeric(value) ? parseFloat(value) : value))
              if (client.hasOwnProperty(key))
                client[key] = val
              else
                throw new Error('User doesnt have that option')
            }

            socket.emit('RS_ChangeUserResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_ChangeUserResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          socket.emit('RS_ChangeUserResponse', {
            id: req.id,
            data: { status: 0, message: e.toString() }
          })
        }
      })

      socket.on('RS_BroadcastRequest', async function(req) {
        try {
          log('RS_BroadcastRequest', {
            caller: req.address,
            message: req.data.message
          })

          if (await isValidAdminRequest(req)) {
            publishEvent('OnBroadcast', req.data.message.replace(/:/gi, ''), 0)
            
            socket.emit('RS_BroadcastResponse', {
              id: req.id,
              data: { status: 1 }
            })
          } else {
            socket.emit('RS_BroadcastResponse', {
              id: req.id,
              data: { status: 0 }
            })
          }
        } catch (e) {
          log('Error:', e)
          
          socket.emit('RS_BroadcastResponse', {
            id: req.id,
            data: { status: 0 }
          })
        }
      })

      socket.on('RS_KickUser', async function(req) {
        if (await isValidAdminRequest(req) && clients.find(c => c.address === req.data.target)) {
          disconnectPlayer(app, clients.find(c => c.address === req.data.target), 'kicked')
        }
      })

      socket.on('RS_InfoRequest', function(req) {
        socket.emit('RS_InfoResponse', {
          id: req.id,
          data: {
            status: 1,
            data: {
              id: config.id,
              version: serverVersion,
              port: app.state.spawnPort,
              round: { id: config.roundId, startedAt: round.startedAt },
              clientCount: clients.length,
              playerCount: clients.filter(c => !c.isDead && !c.isSpectating).length,
              spectatorCount: clients.filter(c => c.isSpectating).length,
              recentPlayersCount: round.players.length,
              spritesCount: config.spritesTotal,
              connectedPlayers: clients.filter(c => !!c.address).map(c => c.address),
              rewardItemAmount: config.rewardItemAmount,
              rewardWinnerAmount: config.rewardWinnerAmount,
              gameMode: config.gameMode,
              orbs: orbs,
              currentReward
            }
          }
        })
      })

      socket.onAny(function(eventName, res) {
        if (!res || !res.id) return
        // log('onAny', eventName, res)

        if (!ioCallbacks[res.id]) {
          log(`Callback ${ioCallbacks[res.id] ? 'Exists' : 'Doesnt Exist'}`, eventName, res)
        }

        if (ioCallbacks[res.id]) {
          log('Callback', eventName, res)

          clearTimeout(ioCallbacks[res.id].timeout)

          ioCallbacks[res.id].resolve(res.data)
    
          delete ioCallbacks[res.id]
        }
      })

      socket.on('disconnect', function() {
        log("User has disconnected")

        currentPlayer.log.clientDisconnected += 1

        disconnectPlayer(app, currentPlayer, 'client disconnected')

        if (currentPlayer.id === realmServer.socket?.id) {
          publishEvent('OnBroadcast', `Realm disconnected`, 0)
        }
      })
    } catch(e) {
      log('Error:', e)
    }
  })
}

export async function initGameServer(app) {
  initEventHandler(app)

  if (Object.keys(clientLookup).length == 0) {
    randomRoundPreset()
    clearSprites()
    spawnSprites(config.spritesStartCount)
  }

  // setTimeout(fastestGameloop, config.fastestLoopSeconds * 1000)

  setTimeout(() => monitorObservers(app), 30 * 1000)
  setTimeout(() => fastGameloop(app), config.fastLoopSeconds * 1000)
  setTimeout(() => slowGameloop(app), config.slowLoopSeconds * 1000)
  setTimeout(() => sendUpdates(app), config.sendUpdateLoopSeconds * 1000)
  setTimeout(() => spawnRewards(app), config.rewardSpawnLoopSeconds * 1000)
  setTimeout(() => checkConnectionLoop(app), config.checkConnectionLoopSeconds * 1000)
  roundLoopTimeout = setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
  // setTimeout(flushEventQueue, config.flushEventQueueSeconds * 1000)
}
