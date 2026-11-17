// Conservative continuation proof for every decision inside one activation.
// Speculation never runs on the live game. Unknown information is NOT a ban.
import { Card } from '../card.js';
import { RuleError } from '../errors.js';
import { combinations } from '../card-sets.js';
import { overflowChoices, actionRequired, canContinueWithHand } from '../inability.js';

const UNKNOWN = Symbol('unknown activation continuation');
const LIMIT = 96;
const reason = '因无法行动限制，此选项会使当前行动玩家在启动结束时空手且没有合法行动。';
const same = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) ===
  JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

// Recreate hero closures and card private slots, then copy the object graph.
// A dynamically installed, unregistered skill cannot be safely cloned: unknown.
export function forkActivationGame(game) {
  const fork = new game.constructor({ ...game.initialConfig, heroIds:game.players.map(p=>p.hero.id),
    heroRules:true, shuffleDeck:false });
  const refs = new Map([[game,fork],[game.turn,fork.turn]]);
  for (const player of game.players) {
    const fresh = fork.player(player.id);
    refs.set(player,fresh); refs.set(player.hero,fresh.hero);
    for (const skill of player.hero.skills) {
      const definition = fresh.hero.skills.find(s=>s.id===skill.id);
      if (!definition) throw UNKNOWN;
      if (Object.keys(skill).some(key=>typeof skill[key]==='function' && String(skill[key])!==String(definition[key]))) throw UNKNOWN;
      refs.set(skill,definition);
    }
  }
  for (const card of game.cards.values()) {
    let fresh = fork.cards.get(card.id);
    if (!fresh) {
      // Extra dynamically registered cards with custom closures are unknown.
      if (Object.values(card).some(v=>typeof v==='function') || card.skills.length) throw UNKNOWN;
      fresh = new Card({id:card.id,name:card.name,elements:card.elements,fates:card.fates,uniqueSkills:card.uniqueSkills});
      Object.setPrototypeOf(fresh,Object.getPrototypeOf(card));
    }
    refs.set(card,fresh);
  }
  const copy = value => {
    if (!value || typeof value!=='object') return value;
    if (refs.has(value)) return refs.get(value);
    const result = value instanceof Map ? new Map() : value instanceof Set ? new Set()
      : Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
    refs.set(value,result);
    if (value instanceof Map) for (const [k,v] of value) result.set(copy(k),copy(v));
    else if (value instanceof Set) for (const v of value) result.add(copy(v));
    else for (const key of Object.keys(value)) result[key]=copy(value[key]);
    return result;
  };
  for (const card of game.cards.values()) {
    const fresh=refs.get(card);
    for (const key of Object.keys(card)) {
      if (typeof card[key]==='function') {
        if (typeof fresh[key]!=='function') throw UNKNOWN;
      } else if (Object.getOwnPropertyDescriptor(fresh,key)?.writable!==false) fresh[key]=copy(card[key]);
    }
    fresh.setLocation(copy(card.location));
  }
  for (const player of game.players) {
    const fresh=refs.get(player);
    for (const key of Object.keys(player)) if (key!=='hero') fresh[key]=copy(player[key]);
    for (const key of Object.keys(player.hero))
      if (typeof player.hero[key]!=='function') fresh.hero[key]=copy(player.hero[key]);
  }
  for (const key of Object.keys(game)) {
    if (typeof game[key]==='function' || key==='activationProbe') continue;
    fork[key]=copy(game[key]);
  }
  for (const key of Object.keys(game.turn)) fork.turn[key]=copy(game.turn[key]);
  fork.random=game.random.clone?.() ?? (()=>{throw UNKNOWN;});
  fork.activationProbe=true;
  fork.presentationEnabled=false;
  // Proofs need the terminal condition, not a diagnostic containing private
  // faces. Full archives are created only by the live rule engine.
  fork.forfeitMaliciousInability=function(actorId,skillId,targetId=actorId){
    if(!actionRequired(this,targetId) || canContinueWithHand(this,targetId,this.player(targetId).hand))return false;
    this.winner=this.player(actorId).team==='red'?'blue':'red';
    this.inabilityArchives.push({responsiblePlayerId:actorId,targetId,skillId});return true;
  };
  return fork;
}

function values(game, request) {
  if (request.choices) return request.choices.map(c=>c.value);
  if (request.type==='cardChoice' || request.type==='overflow') {
    const overflow=request.type==='overflow', playerId=request.playerId ?? request.player.id;
    const spec=overflow ? overflowChoices(game,playerId) : request;
    if (spec.validSets) return [...(request.optional?[null]:[]),...spec.validSets];
    const counts=spec.counts ?? [spec.count], out=request.optional?[null]:[];
    // Bound enumeration BEFORE materializing combinatorial card sets.
    for (const count of counts) {
      let total=1;
      for (let i=1;i<=count;i++) total=total*(spec.valid.length-i+1)/i;
      if (total+out.length>LIMIT) throw UNKNOWN;
      out.push(...combinations(spec.valid,count).filter(set=>!spec.canSelect || spec.canSelect(set)));
    }
    return out;
  }
  if (request.type==='target') return request.targets.map(p=>p.id);
  if (request.type==='weakness') return ['draw','skip'];
  throw UNKNOWN;
}

function protectHiddenCards(fork, live, observerId) {
  const replacements = new Map();
  for (const player of live.players) {
    const privateCards=[...(player.id===observerId?[]:player.hand),
      ...player.covered.filter(c=>c.coveredVisibility!=='public' && player.id!==observerId)];
    for (const card of privateCards) {
      const hidden=fork.cards.get(card.id);
      if (!hidden) continue;
      const proxy=new Proxy(hidden,{get(target,key){
        if (key==='location' || key==='coveredVisibility') return target[key];
        throw UNKNOWN;
      }});
      fork.cards.set(card.id,proxy);
      replacements.set(hidden, proxy);
    }
  }
  if (replacements.size) {
    const mask = card => replacements.get(card) ?? card;
    for (const owner of fork.players) {
      for (const zone of ['hand','covered','statuses']) owner[zone] = owner[zone].map(mask);
    }
    for (const zone of ['deck','discard','field','outside']) fork[zone] = fork[zone].map(mask);
  }
}

function obscureFutureDeck(fork) {
  // Other players may still draw while the activating player stays empty.
  // Carry only card count through those draws; inspecting a new face is unknown.
  // Custom card movement hooks cannot be represented by these abstract cards.
  if ([...fork.cards.values()].some(c=>Object.hasOwn(c,'onMoved') || Object.hasOwn(c,'destinationForMove'))) throw UNKNOWN;
  const hidden = new Set(['name','type','category','elements','element','fates','fate','uniqueSkills','skills','getTraits','hasUniqueSkill','getPrintedTraits']);
  fork.deck=fork.deck.map((old,i)=>{
    const card=new Card({id:`activation-unknown-${i}`,name:'unknown'});
    card.setLocation({zone:'deck'});
    const proxy=new Proxy(card,{get(target,key){
      if(hidden.has(key))throw UNKNOWN;
      if(key==='toJSON')return ()=>({id:target.id,location:target.location});
      const value=Reflect.get(target,key,target);
      return typeof value==='function'?value.bind(target):value;
    }});
    fork.cards.set(card.id,proxy);
    // No stale concrete future face remains accessible through the registry.
    fork.cards.set(old.id,proxy);
    return proxy;
  });
}

function filteredRequest(request, allowed, blocked) {
  const result={...request,activationBlockedChoices:blocked,activationBlockedReason:reason,
    title:`${request.title ?? '选择操作'}\n${reason}`,defaultValue:allowed.some(v=>same(v,request.defaultValue))?request.defaultValue:allowed[0]};
  if (request.choices) result.choices=request.choices.filter(c=>allowed.some(v=>same(v,c.value)));
  if (request.type==='cardChoice' || request.type==='overflow') {
    result.validSets=allowed.filter(Array.isArray);
    result.valid=[...new Set(result.validSets.flat())];
    result.optional=allowed.includes(null);
  }
  if (request.type==='target') result.targets=request.targets.filter(p=>allowed.includes(p.id));
  if (request.type==='skillChoice' && allowed.length===1 && allowed[0]===false) result.blockedReason=reason;
  result.required=allowed.length===1;
  return result;
}

export function* guardedActivation(game, playerId, options, validatedAction) {
  // A previously declined activation returns immediately without offering choices.
  if (game.activationProbe || (validatedAction && game.turn.state?.activationDeclined)) { yield* game.turn.activateUnchecked(playerId,options,validatedAction); return; }
  let base;
  try { base=forkActivationGame(game); } catch { base=null; }
  const history=[];
  const probeOptions=Object.fromEntries(Object.entries(options).filter(([,value])=>typeof value!=='function'));
  // Closures in caller plans may capture live objects; do not execute them.
  delete probeOptions.plan;
  const prove = (candidate, observerId) => {
    let budget=LIMIT;
    const search = path => {
      if (--budget<0 || path.length>64) throw UNKNOWN;
      const fork=forkActivationGame(base);
      protectHiddenCards(fork,game,observerId);
      const iterator=fork.turn.activateUnchecked(playerId,probeOptions,validatedAction);
      let step=iterator.next(), index=0, steps=0;
      while (!step.done) {
        if (++steps>2048) throw UNKNOWN;
        const request=step.value;
        if (request.type==='gameOver') break;
        if (request.type==='presentation') { step=iterator.next(); continue; }
        if (request.type==='promise') throw UNKNOWN;
        if (index===history.length) {
          // Prefix draws already happened. Future draws/shuffles are unknown;
          // never inspect the next card to prove that a choice is forbidden.
          const draw=fork.draw;
          obscureFutureDeck(fork);
          fork.draw=function(id,count,...rest){if(id===playerId && count>0 && (this.deck.length || this.discard.length))throw UNKNOWN;return draw.call(this,id,count,...rest);};
          fork.takeDeckCard=()=>{throw UNKNOWN;};
          fork.random=()=>{throw UNKNOWN;};
        }
        if (index<path.length) step=iterator.next(path[index++]);
        else {
          const remaining=values(fork,request);
          if (!remaining.length) throw UNKNOWN;
          for (const value of remaining) if (!search([...path,value])) return false;
          return true;
        }
      }
      // Ordinary victory ends the game immediately. An inability forfeit in
      // the speculative run is evidence of the unsafe choice, not a victory.
      if (fork.inabilityArchives.length>base.inabilityArchives.length) return true;
      return !fork.winner && fork.player(playerId).hand.length===0 &&
        !canContinueWithHand(fork,playerId,[]);
    };
    try { return search([...history,candidate]); } catch { return false; }
  };
  const iterator=game.turn.activateUnchecked(playerId,options,validatedAction);
  let step=iterator.next();
  try {
    while (!step.done) {
      let request=step.value, allowed=null;
      if (base && !['presentation','promise','gameOver'].includes(request.type)) {
        let candidates;
        try { candidates=values(game,request); } catch { candidates=null; }
        if (candidates && candidates.length<=LIMIT) {
          const observerId=request.playerId ?? request.player?.id ?? request.target?.id ?? playerId;
          const blocked=candidates.filter(value=>prove(value,observerId));
          if (blocked.length) {
            allowed=candidates.filter(value=>!blocked.some(b=>same(b,value)));
            game.auditTrail.push({type:'activationOptionBlocked',playerId:observerId,targetId:playerId,
              skillId:request.skillId,requestType:request.type,blocked,reason});
            if (!allowed.length) {
              game.forfeitMaliciousInability(observerId,request.skillId ?? 'activation',playerId,
                {basis:'noSafeActivationContinuation',blocked});
              if (game.winner) return;
              throw new RuleError(reason);
            }
            request=filteredRequest(request,allowed,blocked);
          }
        }
      }
      const selected=yield request;
      if (allowed && !allowed.some(value=>same(value,selected))) throw new RuleError(reason);
      if (!['presentation','promise','gameOver'].includes(request.type)) history.push(selected);
      step=iterator.next(selected);
    }
    return step.value;
  } finally { iterator.return?.(); }
}
