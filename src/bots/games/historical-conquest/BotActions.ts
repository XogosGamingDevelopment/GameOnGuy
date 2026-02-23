/**
 * Bot Action Types and Message Factory Functions
 * Creates properly formatted messages for Historical Conquest
 */

import { BotAction } from '../../BotInterface';

// Random delay generator (1-3 seconds for human-like timing)
function randomDelay(): number {
  return 1000 + Math.random() * 2000;
}

// Short delay for quick responses
function shortDelay(): number {
  return 200 + Math.random() * 300;
}

// Immediate response
function immediateDelay(): number {
  return 300;
}

/**
 * Create player info message
 */
export function createPlayerInfoMessage(name: string, id: number, isReady: boolean = false): BotAction {
  return {
    type: 'playerinfo',
    data: { type: 1, name, id, set: isReady },
    delay: shortDelay()
  };
}

/**
 * Create ready check message
 */
export function createReadyCheckMessage(clientId: number, ready: boolean = true): BotAction {
  return {
    type: 'rc',
    data: { id: clientId, set: ready },
    delay: randomDelay()
  };
}

/**
 * Create ready for opening land message
 */
export function createReadyForOpeningLandMessage(clientId: number): BotAction {
  return {
    type: 'rfol',
    data: clientId,
    delay: randomDelay()
  };
}

/**
 * Create land played message
 */
export function createLandPlayedMessage(cardValue: number, uniqueId: number, clientId: number): BotAction {
  return {
    type: 'lhp',
    data: { cardValue, uniqueId, clientId },
    delay: randomDelay()
  };
}

/**
 * Create play card message
 */
export function createPlayCardMessage(
  card: number,
  row: number,
  slot: number,
  clientId: number,
  ability: string = '',
  isInterrupt: boolean = false,
  uniqueId: number = 0,
  targetId: number = 0,
  from: number = 0,
  canRespond: boolean = true,
  autoCast: boolean = false
): BotAction {
  return {
    type: 'ppch',
    data: {
      card,
      row,
      slot,
      ability,
      interupt: isInterrupt,
      client: clientId,
      uniqueId: uniqueId || Math.random(),
      targetId,
      from,
      canRespond,
      autoCast
    },
    delay: randomDelay()
  };
}

/**
 * Create accept play message
 */
export function createAcceptPlayMessage(
  cardValue: number,
  row: number,
  clientId: number,
  ability: string = '',
  priorityPass: boolean = false,
  autoplay: boolean = false,
  targetId: number = 0
): BotAction {
  return {
    type: 'aph',
    data: {
      cardValue,
      row,
      ability,
      priorityPass,
      autoplay,
      client: clientId,
      targetId
    },
    delay: immediateDelay()
  };
}

/**
 * Create pass priority message
 */
export function createPassPriorityMessage(clientId: number): BotAction {
  return {
    type: 'pp',
    data: clientId,
    delay: shortDelay()
  };
}

/**
 * Create attack message
 */
export function createAttackMessage(attackRow: number, opponentRow: number, clientId: number): BotAction {
  return {
    type: 'piah',
    data: { row: attackRow, slot: opponentRow, client: clientId },
    delay: randomDelay()
  };
}

/**
 * Create finalize attack message
 */
export function createFinalizeAttackMessage(attackRow: number, opponentRow: number, clientId: number): BotAction {
  return {
    type: 'ftah',
    data: { row: attackRow, slot: opponentRow, client: clientId },
    delay: shortDelay()
  };
}

/**
 * Create accept combat message
 */
export function createAcceptCombatMessage(clientId: number): BotAction {
  return {
    type: 'ac',
    data: clientId,
    delay: shortDelay()
  };
}

/**
 * Create end turn message
 */
export function createEndTurnMessage(clientId: number): BotAction {
  return {
    type: 'pet',
    data: clientId,
    delay: randomDelay()
  };
}

/**
 * Create update deck size message
 */
export function createUpdateDeckSizeMessage(hand: number, deck: number, land: number, clientId: number): BotAction {
  return {
    type: 'ds',
    data: { hand, deck, land, client: clientId },
    delay: 100
  };
}

/**
 * Create phase change message
 */
export function createPhaseChangeMessage(moves: number, phase: string, clientId: number): BotAction {
  return {
    type: 'pcp',
    data: { moves, phase, client: clientId },
    delay: 100
  };
}

/**
 * Create force discard message
 */
export function createForceDiscardMessage(uniqueId: number, targetId: number, clientId: number): BotAction {
  return {
    type: 'fdac',
    data: { uniqueId, clientId, targetId },
    delay: 100
  };
}

/**
 * Create discard from hand message
 */
export function createDiscardFromHandMessage(cardValue: number, clientId: number): BotAction {
  return {
    type: 'pdcp',
    data: { cardvalue: cardValue, client: clientId },
    delay: shortDelay()
  };
}

/**
 * Create highlight card message
 */
export function createHighlightCardMessage(targetUniqueId: number, targetId: number, targetOwnerId: number): BotAction {
  return {
    type: 'hlc',
    data: { uniqueId: targetUniqueId, targetId, clientId: targetOwnerId },
    delay: 100
  };
}

/**
 * Create show winner message
 */
export function createShowWinnerMessage(hostWins: boolean, reason: number): BotAction {
  return {
    type: 'shw',
    data: { set: hostWins, reason },
    delay: 100
  };
}
