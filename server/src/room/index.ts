/**
 * 房间管理：创建、加入、准备、状态流转。
 * 对局逻辑委托给 game 模块；连接管理委托给 ws 模块。
 */
import type { Room, RoomPhase, Seat, Player } from '@mahjong/shared';
import { generateRoomCode, uid } from '../utils/id.js';
import { setRoom, findRoomByCode, getRoom } from '../storage/index.js';

export function createRoom(hostUid: string, hostNickname: string): Room {
  let code: string;
  do {
    code = generateRoomCode();
  } while (findRoomByCode(code));

  const room: Room = {
    roomId: uid(),
    roomCode: code,
    phase: 'waiting',
    ruleset: 'simple4',
    players: [],
    hostPlayerId: hostUid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  addPlayer(room, hostUid, hostNickname);
  return room;
}

export function joinRoom(roomCode: string, playerUid: string, nickname: string): Room | null {
  const room = findRoomByCode(roomCode);
  if (!room) return null;
  if (room.phase !== 'waiting') return null;
  if (room.players.length >= 4) return null;
  if (room.players.some((p) => p.playerId === playerUid)) return room;
  addPlayer(room, playerUid, nickname);
  return room;
}

export function setReady(room: Room, uid: string, ready: boolean): void {
  const player = room.players.find((p) => p.playerId === uid);
  if (player) player.ready = ready;
  room.updatedAt = Date.now();
}

export function allReady(room: Room): boolean {
  return room.players.length === 4 && room.players.every((p) => p.ready);
}

export function setPhase(room: Room, phase: RoomPhase): void {
  room.phase = phase;
  room.updatedAt = Date.now();
}

function addPlayer(room: Room, uid: string, nickname: string): void {
  const seat = room.players.length as Seat;
  const player: Player = { playerId: uid, nickname, seat, ready: false, online: true, score: 0 };
  room.players.push(player);
  setRoom(room);
}