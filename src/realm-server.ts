import axios from 'axios';
import { isValidRequest, getSignedRequest } from '@arken/node/util/web3';
import { log, logError, getTime, isEthereumAddress } from '@arken/node/util';
import { emitDirect } from '@arken/node/util/websocket';
import { upgradeCodebase } from '@arken/node/util/codebase';
import { initTRPC, TRPCError } from '@trpc/server';
import { customErrorFormatter, transformer, hasRole, validateRequest } from '@arken/node/util/rpc';
import shortId from 'shortId';
import fs from 'fs';
import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import { log, logError } from '@arken/node/util';
import { catchExceptions } from '@arken/node/util/process';
import type { Profile } from '@arken/node/types';
import { Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import packageJson from '../package.json';
import { z } from 'zod';
import { createRouter } from '@arken/evolution-protocol/realm/server';
import { initWebServer } from './web-server';
import { initMonitor } from './monitor';
import { schema } from '@arken/node/types';
import type { Realm } from '@arken/evolution-protocol/types';
import { ShardBridge } from './shard-bridge';

dotenv.config();

export class RealmServer implements Realm.Server {
  client: Realm.Client;
  state: schema.Data;
  server: Express;
  isHttps: boolean;
  https?: HttpsServer;
  http?: HttpServer;
  io: SocketServer;
  config: Realm.ApplicationConfig;
  maxClients: number;
  subProcesses: any[];
  seerList: string[];
  adminList: string[];
  modList: string[];
  sockets: Record<string, any>;
  version: string;
  endpoint: string;
  shards: ShardBridge[];
  profiles: Record<string, Profile>;
  web3: any; // Assume web3 is a configured instance
  secrets: any; // Secrets for signing
  emit: Realm.Router;
  seer: Realm.Seer;
  clients: Realm.Client[];
  playerRewards: Record<string, any>;
  spawnPort: string | number;
  rewards: any;
  rewardSpawnPoints: any;
  rewardSpawnPoints2: any;

  constructor() {
    this.emit = createRouter(this as Realm.Server);

    this.server = express();
    this.server.set('trust proxy', 1);
    this.server.use(helmet());
    this.server.use(
      cors({
        allowedHeaders: [
          'Accept',
          'Authorization',
          'Cache-Control',
          'X-Requested-With',
          'Content-Type',
          'applicationId',
        ],
      })
    );

    this.isHttps = process.env.ARKEN_ENV !== 'local';

    if (this.isHttps) {
      this.https = require('https').createServer(
        {
          key: fs.readFileSync(path.resolve('./privkey.pem')),
          cert: fs.readFileSync(path.resolve('./fullchain.pem')),
        },
        this.server
      );
    } else {
      this.http = require('http').Server(this.server);
    }

    this.io = new SocketServer(this.isHttps ? this.https : this.http, {
      pingInterval: 30 * 1000,
      pingTimeout: 90 * 1000,
      upgradeTimeout: 20 * 1000,
      allowUpgrades: true,
      cookie: false,
      serveClient: false,
      allowEIO3: true,
      cors: {
        origin: '*',
      },
    });
  }

  async init() {
    catchExceptions();

    try {
      log('RealmServer init');

      await mongoose.connect(process.env.DATABASE_URL!, {
        // useNewUrlParser: true,
        // useUnifiedTopology: true,
      });

      if (this.isHttps) {
        const sslPort = process.env.RS_SSL_PORT || 443;
        this.https.listen(sslPort, function () {
          log(`:: Backend ready and listening on *:${sslPort} (https)`);
        });
      } else {
        // Finalize
        const port = process.env.RS_PORT || 80;
        this.http.listen(port, function () {
          log(`:: Backend ready and listening on *:${port} (http)`);
        });
      }

      this.version = packageJson.version;
      this.endpoint = 'ptr1.isles.arken.gg';
      this.clients = [];
      this.sockets = {};
      this.shards = {};
      this.profiles = {};
      this.seerList = ['0x4b64Ff29Ee3B68fF9de11eb1eFA577647f83151C'];
      this.adminList = ['0xDfA8f768d82D719DC68E12B199090bDc3691fFc7', '0x4b64Ff29Ee3B68fF9de11eb1eFA577647f83151C'];
      this.modList = [
        '0x4b64Ff29Ee3B68fF9de11eb1eFA577647f83151C',
        '0xa987f487639920A3c2eFe58C8FBDedB96253ed9B',
        '0x1a367CA7bD311F279F1dfAfF1e60c4d797Faa6eb',
        '0x545612032BeaDED7E9f5F5Ab611aF6428026E53E',
        '0x37470038C615Def104e1bee33c710bD16a09FdEf',
        '0x150F24A67d5541ee1F8aBce2b69046e25d64619c',
        '0xfE27380E57e5336eB8FFc017371F2147A3268fbE',
        '0x3551691499D740790C4511CDBD1D64b2f146f6Bd',
        '0xe563983d6f46266Ad939c16bD59E5535Ab6E774D',
        '0x62c79c01c33a3761fe2d2aD6f8df324225b8073b',
        '0x82b644E1B2164F5B81B3e7F7518DdE8E515A419d',
        '0xeb3fCb993dDe8a2Cd081FbE36238E4d64C286AC0',
      ];

      this.io.on('connection', (socket) => {
        const ip = 'HIDDEN';
        log('Client connected from ' + ip);

        const client: Realm.Client = {
          id: socket.id,
          name: 'Unknown' + Math.floor(Math.random() * 999),
          ip,
          info: null,
          lastReportedTime: getTime(),
          isMod: false,
          isAdmin: false,
          log: {
            clientDisconnected: 0,
          },
        };

        this.sockets[client.id] = socket;
        this.clients.push(client);
        this.shards = [];
        this.playerRewards = {} as any;
        this.spawnPort = this.isHttps ? process.env.GS_SSL_PORT || 8443 : process.env.GS_PORT || 8080;
        this.rewards = {
          runes: [
            {
              type: 'rune',
              symbol: 'solo',
              quantity: 10000,
            },
            // {
            //   type: 'rune',
            //   symbol: 'tyr',
            //   quantity: 100,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'nen',
            //   quantity: 100,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'isa',
            //   quantity: 10000,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'han',
            //   quantity: 100,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'ro',
            //   quantity: 10000,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'thal',
            //   quantity: 10000,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'ash',
            //   quantity: 10000,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'ore',
            //   quantity: 10000,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'sen',
            //   quantity: 100,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'tai',
            //   quantity: 10000,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'da',
            //   quantity: 100,
            // },
            // {
            //   type: 'rune',
            //   symbol: 'zel',
            //   quantity: 0,
            // },
          ],
          items: [],
          characters: [
            {
              type: 'character',
              tokenId: '1',
            },
          ],
        } as any;

        this.profiles = {};

        // Override because we didnt get response from RS yet
        this.config.rewardItemAmount = 0;
        this.config.rewardWinnerAmount = 0;
        this.rewardSpawnPoints = [
          { x: -16.32, y: -15.7774 },
          { x: -9.420004, y: -6.517404 },
          { x: -3.130003, y: -7.537404 },
          { x: -7.290003, y: -12.9074 },
          { x: -16.09, y: -2.867404 },
          { x: -5.39, y: -3.76 },
          { x: -7.28, y: -15.36 },
          { x: -13.46, y: -13.92 },
          { x: -12.66, y: -1.527404 },
        ];
        this.rewardSpawnPoints2 = [
          { x: -16.32, y: -15.7774 },
          { x: -9.420004, y: -6.517404 },
          { x: -3.130003, y: -7.537404 },
          { x: -7.290003, y: -12.9074 },
          { x: -16.09, y: -2.867404 },
          { x: -5.39, y: -3.76 },
          { x: -12.66, y: -1.527404 },

          { x: -24.21, y: -7.58 },
          { x: -30.62, y: -7.58 },
          { x: -30.8, y: -14.52 },
          { x: -20.04, y: -15.11 },
          { x: -29.21, y: -3.76 },
          { x: -18.16, y: 0.06 },
          { x: -22.98, y: -3.35 },
          { x: -25.92, y: -7.64 },
          { x: -20.1, y: -6.93 },
          { x: -26.74, y: 0 },
          { x: -32.74, y: -5.17 },
          { x: -25.74, y: -15.28 },
          { x: -22.62, y: -11.69 },
          { x: -26.44, y: -4.05 },
        ];

        socket.on('trpc', async (message) => {
          const { id, method, params } = message;

          try {
            const ctx = { app, socket, client };
            const createCaller = t.createCallerFactory(this.router);
            const caller = createCaller(ctx);
            const result = await caller[method](params);
            socket.emit('trpcResponse', { id, result });
          } catch (error) {
            socket.emit('trpcResponse', { id, error: error.message });
          }
        });

        socket.on('disconnect', async () => {
          log('Client has disconnected');

          if (client.isSeer) {
            for (const shard of this.shards) {
              await shard.emit.seerDisconnected.mutate(); // await getSignedRequest(this.web3, this.secrets, {}), {});
            }
          }

          // client.log.clientDisconnected += 1;
          // delete this.sockets[client.id];
          // delete this.clientLookup[client.id];
          // this.clients = this.clients.filter((c) => c.id !== client.id);
        });
      });

      // this.upgrade = upgradeCodebase;
      // this.call = sendEventToObshards.bind(null, app);

      await initMonitor(this);
      await initWebServer(this);
    } catch (e) {
      logError(e);
    }
  }

  async auth({ signature }: { signature: { address: string; hash: string } }) {
    const { address } = signature;

    if (this.seerList.includes(address)) {
      this.client.isSeer = true;
      this.client.isAdmin = true;
      this.client.isMod = true;
      // await this.onSeerConnected();
    } else if (this.adminList.includes(address)) {
      this.client.isSeer = false;
      this.client.isAdmin = true;
      this.client.isMod = true;
    } else if (this.modList.includes(address)) {
      this.client.isSeer = false;
      this.client.isAdmin = false;
      this.client.isMod = true;
    } else {
      this.client.isSeer = false;
      this.client.isAdmin = false;
      this.client.isMod = false;
    }

    return { status: 1 };
  }

  async setConfig({ data }: { data: { shardId: string; config: Record<string, any> } }) {
    this.config = {
      ...this.config,
      ...data.config,
    };

    await this.shards[data.shardId].router.setConfigRequest.mutate(
      await getSignedRequest(this.web3, this.secrets, data),
      data
    );

    return { status: 1 };
  }

  async ping() {
    return { status: 1 };
  }

  async info() {
    const games = this.clients.map((client) => client.info).filter((info) => !!info);
    const playerCount = games.reduce((total, game) => total + game.playerCount, 0);
    const speculatorCount = games.reduce((total, game) => total + game.speculatorCount, 0);

    return {
      status: 1,
      data: {
        playerCount,
        speculatorCount,
        version: this.version,
        games,
      },
    };
  }

  async addMod({
    signature,
    data: { target },
  }: {
    signature: { address: string; hash: string };
    data: { target: string };
  }) {
    this.modList.push(target);
    return { status: 1 };
  }

  async removeMod({
    signature,
    data: { target },
  }: {
    signature: { address: string; hash: string };
    data: { target: string };
  }) {
    this.modList = this.modList.filter((addr) => addr !== target);
    return { status: 1 };
  }

  async banClient({ data }: { data: { target: string } }) {
    for (const shardId of Object.keys(this.shards)) {
      const res = await this.shards[shardId].banClient.mutate(data);
      if (res.status !== 1) {
        log('Failed to ban client', data.target, shardId);
      }
    }
    return { status: 1 };
  }

  async banUser({
    data,
    signature,
  }: {
    data: { target: string; bannedReason: string; bannedUntil: string };
    signature: { address: string; hash: string };
  }) {
    this.seer.emit.banUser.mutate(data);

    for (const shardId of Object.keys(this.shards)) {
      const res = await this.shards[shardId].emit.kickClient.mutate(data);

      if (!res.status) {
        log('Failed to kick client', data.target, shardId);
      }
    }

    return { status: 1 };
  }

  async getState() {
    return {
      status: 1,
      data: {
        config: this.config,
        adminList: this.adminList,
        modList: this.modList,
      },
    };
  }

  async unbanClient({ data, signature }: { data: { target: string }; signature: { address: string; hash: string } }) {
    for (const shardId of Object.keys(this.shards)) {
      const res = await this.shards[shardId].unbanClient.mutate({ target: data.target });

      if (!res.status) {
        log('Failed to kick client', data.target, shardId);
      }
    }

    return { status: 1 };
  }

  async matchShard() {
    for (const shard of Object.values(this.shards)) {
      if (shard.clientCount < this.config.maxClients) {
        return { status: 1, endpoint: shard.endpoint, port: 4020 };
      }
    }
    return { status: 0, message: 'Failed to find shard' };
  }

  // async call({ data, signature }: { data: { method: string }; signature: { address: string; hash: string } }) {
  //   return await this.call(data.method, signature, data);
  // }

  // private async onSeerConnected() {
  //   return await this.emit.seerConnected.mutate(await getSignedRequest(this.web3, this.secrets, {}), {});
  // }
}

export function init() {
  const realmServer = new RealmServer();

  return realmServer;
}
