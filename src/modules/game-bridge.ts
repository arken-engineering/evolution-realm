import { spawn } from 'child_process'
import jetpack from 'fs-jetpack'
import { io as ioClient } from 'socket.io-client'
import { log, logError, random, getTime } from '../util'
import { web3 } from '../util/web3'
import { emitDirect } from '../util/websocket'
import { upgradeGsCodebase, cloneGsCodebase } from '../util/codebase'

const path = require('path')
const shortId = require('shortid')

function getSocket(endpoint) {
  log('Connecting to', endpoint)
  return ioClient(endpoint, {
    transports: ['websocket'],
    upgrade: false,
    autoConnect: false,
    // pingInterval: 5000,
    // pingTimeout: 20000
    // extraHeaders: {
    //   "my-custom-header": "1234"
    // }
  })
}

function startGameServer(app) {
  // const binaryPath = {
  //   linux: '../game-server/build/index.js',
  //   darwin: '../game-server/build/index.js',
  //   win32: ''
  // }[process.platform]

  console.log(path.join(__dirname, '../../game-server'))
  // Start the server
  app.gameBridge.process = spawn('node',
    ['build/index.js'], 
    {cwd: path.join(__dirname, '../../game-server'), env: { ...process.env, SUDO_USER: 'dev2' }, stdio: ['ignore', 'pipe', 'pipe']}
  )

  app.gameBridge.process.stdout.pipe(process.stdout)
  app.gameBridge.process.stderr.pipe(process.stderr)

  app.gameBridge.process.on('exit', (code, signal) => log(`Child process exited with code ${code} and signal ${signal}`))

  app.subProcesses.push(app.gameBridge.process)
}

async function callGameServer(app, name, data = {}) {
  if (!app.gameBridge.socket?.connected) {
    log(`Can't send GS message, not connected.`)
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const id = shortId()
    
    const timeout = setTimeout(function() {
      resolve({ status: 0, message: 'Request timeout' })

      delete app.gameBridge.ioCallbacks[id]
    }, 2 * 1000)

    app.gameBridge.ioCallbacks[id] = { resolve, reject, timeout }

    app.gameBridge.socket.emit(name, { id, data })
  })
}

function connectGameServer(app) {
  if (app.gameBridge.socket) {
    app.gameBridge.socket.close()
  }

  const server = {
    endpoint: 'localhost:' + process.env.GS_PORT,
    key: 'local1'
  }

  const socket = app.gameBridge.socket = getSocket('http://' + server.endpoint)
  let connectTimeout

  socket.on('connect', function() {
    log('Connected: ' + server.key)

    clearTimeout(connectTimeout)

    socket.emit('RS_Connected')
  })

  socket.on('disconnect', function() {
    log('Disconnected: ' + server.key)
  })

  socket.on('GS_Ping', function(msg) {
    log(msg)
  })

  socket.on('GS_Init', function(msg) {
    // TODO: Validate GS key
    log(msg)
  })

  // Use by GS to tell RS it's connected
  socket.on('GS_Connect', function() {
    emitDirect(socket, 'OnConnected')
  })

  socket.on('GS_ConfigureRequest', function(req) {
    // TODO: Validate is authed
    try {
      log('GS_ConfigureRequest', req)

      const { config } = app.gameBridge.state

      config.totalLegitPlayers = 1

      for (const client of req.data.clients) {
        if (client.name.indexOf('Guest') !== -1 || client.name.indexOf('Unknown') !== -1) continue

        try {
          if ((client.points > 100 && client.kills > 1) || (client.points > 300 && client.evolves > 20 && client.powerups > 200) || (client.rewards > 3 && client.powerups > 200) || (client.evolves > 100) || (client.points > 1000)) {
            config.totalLegitPlayers += 1
          }
        } catch (e) {
          console.log(e)
        }
      }

      config.rewardItemAmount = parseFloat((Math.round(Math.min(config.totalLegitPlayers * config.rewardItemAmountPerLegitPlayer, config.rewardItemAmountMax) * 1000) / 1000).toFixed(3))
      config.rewardWinnerAmount = parseFloat((Math.round(Math.min(config.totalLegitPlayers * config.rewardWinnerAmountPerLegitPlayer, config.rewardWinnerAmountMax) * 1000) / 1000).toFixed(3))

      emitDirect(socket, 'GS_ConfigureResponse', {
        id: req.id,
        data: {
          status: 1,
          data: {
            rewardWinnerAmount: config.rewardWinnerAmount
          }
        }
      })
    } catch (e) {
      logError(e)

      emitDirect(socket, 'GS_ConfigureResponse', {
        id: req.id,
        data: { status: 0 }
      })
    }
  })

  socket.on('GS_SaveRoundRequest', async function(req) {
    // TODO: Validate is authed
    try {
      log('GS_SaveRoundRequest', req)

      // Update player stat DB
      const res = await app.realm.call('SaveRoundRequest', req.data)

      emitDirect(socket, 'GS_SaveRoundResponse', {
        id: req.id,
        data: res
      })
    } catch (e) {
      logError(e)

      emitDirect(socket, 'GS_SaveRoundResponse', {
        id: req.id,
        data: { status: 0 }
      })
    }
  })

  socket.on('GS_ConfirmUserRequest', function(req) {
    // TODO: Validate is authed
    try {
      log('GS_ConfirmUser', {
        caller: req.data.address
      })

      if (!app.realm.state.banList.includes(req.data.address)) {
        emitDirect(socket, 'GS_ConfirmUserResponse', {
          id: req.id,
          data: { status: 1 }
        })
      } else {
        emitDirect(socket, 'GS_ConfirmUserResponse', {
          id: req.id,
          data: { status: 0 }
        })
      }
    } catch (e) {
      logError(e)
      
      emitDirect(socket, 'GS_ConfirmUserResponse', {
        id: req.id,
        data: { status: 0 }
      })
    }
  })

  socket.on('GS_ReportUserRequest', function (req) {
    // TODO: Validate is authed
    try {
      log('GS_ReportUser', {
        caller: req.data.address
      })

      if (req.data.reportedAddress && !app.realm.state.banList.includes(req.data.reportedAddress)) {
        emitDirect(socket, 'GS_ReportUserResponse', {
          id: req.id,
          data: { status: 1 }
        })
      } else {
        emitDirect(socket, 'GS_ReportUserResponse', {
          id: req.id,
          data: { status: 0 }
        })
      }
    } catch (e) {
      logError(e)
      
      emitDirect(socket, 'GS_ReportUserResponse', {
        id: req.id,
        data: { status: 0 }
      })
    }
  })

  socket.on('GS_VerifySignatureRequest', function(req) {
    try {
      // TODO: Validate is authed
      emitDirect(socket, 'GS_VerifySignatureResponse', {
        id: req.id,
        data: web3.eth.accounts.recover(req.data.value, req.data.hash).toLowerCase() === req.data.address.toLowerCase()
      })
    } catch(e) {
      logError(e)
    }
  })

  socket.on('GS_VerifyAdminSignatureRequest', function(req) {
    try {
      // TODO: Validate is authed
      const normalizedAddress = web3.utils.toChecksumAddress(req.data.address.trim())
      emitDirect(socket, 'GS_VerifyAdminSignatureResponse', {
        id: req.id,
        data: web3.eth.accounts.recover(req.data.value, req.data.hash).toLowerCase() === req.data.address.toLowerCase() && app.realm.state.modList.includes(normalizedAddress)
      })
    } catch(e) {
      logError(e)
    }
  })

  socket.on('GS_NormalizeAddressRequest', function(req) {
    try {
      // TODO: Validate is authed
      emitDirect(socket, 'GS_NormalizeAddressResponse', {
        id: req.id,
        data: web3.utils.toChecksumAddress(req.data.address.trim())
      })
    } catch(e) {
      logError(e)
    }
  })

  // socket.on('GS_ClaimRewardRequest', function(req) {
  //   // TODO: Validate is authed
  //   try {
  //     const { currentPlayer, reward } = req.data
  //     const { config, playerRewards, rewards } = app.gameBridge.state

  //     if (currentPlayer.address) {
  //       if (reward.type === 'rune') {
  //         if (!playerRewards[currentPlayer.address]) playerRewards[currentPlayer.address] = {}
  //         if (!playerRewards[currentPlayer.address].pending) playerRewards[currentPlayer.address].pending = {}
  //         if (!playerRewards[currentPlayer.address].pending[reward.symbol]) playerRewards[currentPlayer.address].pending[reward.symbol] = 0

  //         playerRewards[currentPlayer.address].pending[reward.symbol] = Math.round((playerRewards[currentPlayer.address].pending[reward.symbol] + reward.quantity) * 1000) / 1000
          
  //         rewards.runes.find(r => r.symbol === reward.symbol).quantity -= reward.quantity
  //       } else {
  //         if (!playerRewards[currentPlayer.address]) playerRewards[currentPlayer.address] = {}
  //         if (!playerRewards[currentPlayer.address].pendingItems) playerRewards[currentPlayer.address].pendingItems = []

  //         playerRewards[currentPlayer.address].pendingItems.push(JSON.parse(JSON.stringify(reward)))
  //       }
  //     }
  //   } catch(e) {
  //     logError(e)
  //   }
  // })

  socket.on('GS_GetRandomRewardRequest', function(req) {
    try {
      // TODO: Validate is authed
      const now = getTime()

      const { config } = app.gameBridge.state

      if (!config.drops) config.drops = {}
      if (!config.drops.guardian) config.drops.guardian = 1633043139000
      if (!config.drops.earlyAccess) config.drops.earlyAccess = 1633043139000
      if (!config.drops.trinket) config.drops.trinket = 1633043139000
      if (!config.drops.santa) config.drops.santa = 1633043139000
      if (!config.drops.runeword) config.drops.runeword = 1633043139000
      if (!config.drops.runeToken) config.drops.runeToken = 1633043139000

      const timesPer10Mins = Math.round(10 * 60 / config.rewardSpawnLoopSeconds)
      const randPer10Mins = random(0, timesPer10Mins)
      const timesPerDay = Math.round(40 * 60 * 60 / config.rewardSpawnLoopSeconds)
      const randPerDay = random(0, timesPerDay)
      const timesPerWeek = Math.round(10 * 24 * 60 * 60 / config.rewardSpawnLoopSeconds)
      const randPerWeek = random(0, timesPerWeek)
      const timesPerBiweekly = Math.round(20 * 24 * 60 * 60 / config.rewardSpawnLoopSeconds)
      const randPerBiweekly = random(0, timesPerBiweekly)
      const timesPerMonth = Math.round(31 * 24 * 60 * 60 / config.rewardSpawnLoopSeconds)
      const randPerMonth = random(0, timesPerMonth)

      let tempReward

      if ((now - config.drops.guardian) > 48 * 60 * 60 * 1000 && randPerDay === Math.round(timesPerDay / 2)) { // (now - config.drops.guardian) > 12 * 60 * 60 * 1000) {
        tempReward = {
          id: shortId.generate(),
          position: config.level2open ? app.gameBridge.state.rewardSpawnPoints2[random(0, app.gameBridge.state.rewardSpawnPoints2.length-1)] : app.gameBridge.state.rewardSpawnPoints[random(0, app.gameBridge.state.rewardSpawnPoints.length-1)],
          enabledAt: now,
          name: 'Guardian Egg',
          rarity: 'Magical',
          quantity: 1,
          rewardItemName: tempReward.rarity + ' ' + tempReward.name,
          rewardItemType: 2
        }

        const rand = random(0, 1000)
        
        if (rand === 1000)
          tempReward.rarity = 'Mythic'
        else if (rand > 950)
          tempReward.rarity = 'Epic'
        else if (rand > 850)
          tempReward.rarity = 'Rare'

        config.drops.guardian = now
      } else if ((now - config.drops.earlyAccess) > 30 * 24 * 60 * 60 * 1000 && randPerMonth === Math.round(timesPerMonth / 2)) { // (now - config.drops.earlyAccess) > 7 * 24 * 60 * 60 * 1000
        tempReward = {
          id: shortId.generate(),
          position: config.level2open ? app.gameBridge.state.rewardSpawnPoints2[random(0, app.gameBridge.state.rewardSpawnPoints2.length-1)] : app.gameBridge.state.rewardSpawnPoints[random(0, app.gameBridge.state.rewardSpawnPoints.length-1)],
          enabledAt: now,
          name: `Early Access Founder's Cube`,
          rarity: 'Unique',
          quantity: 1,
          rewardItemName: tempReward.name,
          rewardItemType: 3
        }

        config.drops.earlyAccess = now
      // } else if (randPer10Mins === Math.round(timesPer10Mins / 2)) { // (now - config.drops.earlyAccess) > 7 * 24 * 60 * 60 * 1000
      //   tempReward = {
      //     id: shortId.generate(),
      //     position: config.level2open ? rewardSpawnPoints2[random(0, rewardSpawnPoints2.length-1)] : rewardSpawnPoints[random(0, rewardSpawnPoints.length-1)],
      //     enabledAt: now,
      //     name: `Santa Christmas 2021 Ticket`,
      //     rarity: 'Normal',
      //     quantity: 1
      //   }

      //   sharedConfig.rewardItemName = tempReward.name
      //   sharedConfig.rewardItemType = 6
      //   config.rewardItemName = sharedConfig.rewardItemName
      //   config.rewardItemType = sharedConfig.rewardItemType

      //   config.drops.santa = now
      } else if ((now - config.drops.trinket) > 24 * 60 * 60 * 1000 && randPerDay === Math.round(timesPerDay / 4)) { // (now - config.drops.trinket) > 12 * 60 * 60 * 1000
        tempReward = {
          id: shortId.generate(),
          position: config.level2open ? app.gameBridge.state.rewardSpawnPoints2[random(0, app.gameBridge.state.rewardSpawnPoints2.length-1)] : app.gameBridge.state.rewardSpawnPoints[random(0, app.gameBridge.state.rewardSpawnPoints.length-1)],
          enabledAt: now,
          name: 'Trinket',
          rarity: 'Magical',
          quantity: 1,
          rewardItemName: tempReward.rarity + ' ' + tempReward.name,
          rewardItemType: 4
        }

        const rand = random(0, 1000)
        
        if (rand === 1000)
          tempReward.rarity = 'Mythic'
        else if (rand > 950)
          tempReward.rarity = 'Epic'
        else if (rand > 850)
          tempReward.rarity = 'Rare'

        config.drops.trinket = now
      } else if ((now - config.drops.runeword) > 12 * 60 * 60 * 1000 && randPerDay === Math.round(timesPerDay / 5)) { // (now - config.drops.runeword) > 24 * 60 * 60 * 1000
        config.drops.runeword = now
      } else if ((now - config.drops.runeToken) > 31 * 24 * 60 * 60 * 1000 && randPerMonth === timesPerMonth / 3) { // (now - config.drops.runeToken) > 7 * 24 * 60 * 60 * 1000
        tempReward = {
          id: shortId.generate(),
          position: config.level2open ? app.gameBridge.state.rewardSpawnPoints2[random(0, app.gameBridge.state.rewardSpawnPoints2.length-1)] : app.gameBridge.state.rewardSpawnPoints[random(0, app.gameBridge.state.rewardSpawnPoints.length-1)],
          enabledAt: now,
          name: 'RUNE',
          rarity: 'Normal',
          quantity: 1,
          rewardItemName: tempReward.quantity + ' ' + tempReward.name,
          rewardItemType: 5
        }

        const rand = random(0, 1000)
        
        if (rand === 1000)
          tempReward.quantity = 10
        else if (rand > 990)
          tempReward.quantity = 3
        else if (rand > 950)
          tempReward.quantity = 2

        config.drops.runeToken = now
      } else {
        const odds = [
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
          'runes'
        ]
      
        const rewardType = app.gameBridge.state.rewards[odds[random(0, odds.length-1)]]
      
        if (!rewardType || rewardType.length === 0) {
          emitDirect(socket, 'GS_GetRandomRewardResponse', {
            id: req.id,
            data: null
          })
          return
        }
      
        const reward = rewardType[random(0, rewardType.length-1)]
      
        if (reward.type === 'rune' && reward.quantity <= 0) {
          emitDirect(socket, 'GS_GetRandomRewardResponse', {
            id: req.id,
            data: null
          })
          return
        }
      
        const now = getTime()
      
        tempReward = JSON.parse(JSON.stringify(reward))
        tempReward.id = shortId.generate()
        tempReward.position = config.level2open ? app.gameBridge.state.rewardSpawnPoints2[random(0, app.gameBridge.state.rewardSpawnPoints2.length-1)] : app.gameBridge.state.rewardSpawnPoints[random(0, app.gameBridge.state.rewardSpawnPoints.length-1)]
        tempReward.enabledAt = now
        tempReward.quantity = config.rewardItemAmount
        
        if (tempReward.type === 'rune') {
          tempReward.rewardItemType = 0
          tempReward.rewardItemName = tempReward.symbol.toUpperCase()
        }
      }

      emitDirect(socket, 'GS_GetRandomRewardResponse', {
        id: req.id,
        data: tempReward
      })
    } catch(e) {
      logError(e)
    }
  })

  socket.onAny(function(eventName, res) {
    try {
      if (eventName === 'Events') return

      const { id, data } = res

      log(`Callback ${app.gameBridge.ioCallbacks[id] ? 'Exists' : 'Doesnt Exist'}`, eventName)

      if (app.gameBridge.ioCallbacks[id]) {
        clearTimeout(app.gameBridge.ioCallbacks[id].timeout)

        app.gameBridge.ioCallbacks[id].resolve(data)

        delete app.gameBridge.ioCallbacks[id]
      }
    } catch(e) {
      logError(e)
    }
  })

  connectTimeout = setTimeout(function() {
    logError('Could not connect.')

    socket.close()
  }, 5000)

  socket.connect()
}

export function initGameBridge(app) {
  app.gameBridge = {}

  app.gameBridge.state = {}

  app.gameBridge.socket = null

  app.gameBridge.state.playerRewards = {} as any

  app.gameBridge.ioCallbacks = {}

  app.gameBridge.state.rewards = {
    "runes": [
      {
        "type": "rune",
        "symbol": "sol",
        "quantity": 100
      },
      {
        "type": "rune",
        "symbol": "tir",
        "quantity": 100
      },
      {
        "type": "rune",
        "symbol": "nef",
        "quantity": 100
      },
      {
        "type": "rune",
        "symbol": "ith",
        "quantity": 10000
      },
      {
        "type": "rune",
        "symbol": "hel",
        "quantity": 100
      },
      {
        "type": "rune",
        "symbol": "ral",
        "quantity": 10000
      },
      {
        "type": "rune",
        "symbol": "thul",
        "quantity": 10000
      },
      {
        "type": "rune",
        "symbol": "amn",
        "quantity": 10000
      },
      {
        "type": "rune",
        "symbol": "ort",
        "quantity": 10000
      },
      {
        "type": "rune",
        "symbol": "shael",
        "quantity": 100
      },
      {
        "type": "rune",
        "symbol": "tal",
        "quantity": 10000
      },
      {
        "type": "rune",
        "symbol": "dol",
        "quantity": 100
      },
      {
        "type": "rune",
        "symbol": "zod",
        "quantity": 0
      }
    ],
    "items": [],
    "characters": [
      {
        "type": "character",
        "tokenId": "1"
      }
    ]
  } as any
  
  app.gameBridge.state.config = jetpack.read(path.resolve('./public/data/config.json'), 'json')
  
  app.gameBridge.state.rewardSpawnPoints = [
    {x: -16.32, y: -15.7774},
    {x: -9.420004, y: -6.517404},
    {x: -3.130003, y: -7.537404},
    {x: -7.290003, y: -12.9074},
    {x: -16.09, y: -2.867404},
    {x: -5.39, y: -3.76},
    {x: -7.28, y: -15.36},
    {x: -13.46, y: -13.92},
    {x: -12.66, y: -1.527404},
  ]
  
  app.gameBridge.state.rewardSpawnPoints2 = [
    {x: -16.32, y: -15.7774},
    {x: -9.420004, y: -6.517404},
    {x: -3.130003, y: -7.537404},
    {x: -7.290003, y: -12.9074},
    {x: -16.09, y: -2.867404},
    {x: -5.39, y: -3.76},
    {x: -12.66, y: -1.527404},
  
    {x: -24.21, y: -7.58},
    {x: -30.62, y: -7.58},
    {x: -30.8, y: -14.52},
    {x: -20.04, y: -15.11},
    {x: -29.21, y: -3.76},
    {x: -18.16, y: 0.06},
    {x: -22.98, y: -3.35},
    {x: -25.92, y: -7.64},
    {x: -20.1, y: -6.93},
    {x: -26.74, y: 0},
    {x: -32.74, y: -5.17},
    {x: -25.74, y: -15.28},
    {x: -22.62, y: -11.69},
    {x: -26.44, y: -4.05},
  ]

  app.gameBridge.process = null
  
  app.gameBridge.call = callGameServer.bind(null, app)

  app.gameBridge.start = startGameServer.bind(null, app)

  app.gameBridge.connect = connectGameServer.bind(null, app)

  app.gameBridge.clone = cloneGsCodebase

  app.gameBridge.upgrade = upgradeGsCodebase
}