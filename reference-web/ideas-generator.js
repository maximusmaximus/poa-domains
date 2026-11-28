import { IDEA_WORDS, IDEA_EMOJI, inspectName } from "./shared.js?v=bdd52e3a245b";

// Massive curated list of obvious everyday, tech, AI, crypto, finance, nature, creative & short root words.
const CURATED_WORD_BANK = (
  // High-demand tech, AI, agents, crypto & web
  "ai bot agent agents agentic mind brain neural model models prompt prompts token tokens chain block blocks node nodes " +
  "miner mining proof stake vault wallet wallets pay payment payments cash coin coins money bank finance fund " +
  "funds trade trading market markets swap dex defi dao web net web3 cloud edge server host hosting data code " +
  "coder coding dev devs build builder builders hack hacker app apps api sdk mcp cli git repo hub lab labs " +
  "studio studios tech digital cyber crypto hash key keys sign signer ledger trust verify open mesh grid link " +
  "links sync stream flow pulse signal spark core base zero one bit byte mega giga tera nano micro hyper ultra " +
  "meta proto alpha beta gamma delta omega prime apex nexus matrix vector tensor synth quantum logic chip " +
  "chips pixel pixels frame frames render shader gpu cpu stack cache queue route router proxy tunnel port " +
  "domain domains name names dns ipfs cid pin pins store storage bucket backup archive index search find query " +
  // Everyday nouns, concepts & brands
  "home house room door window roof wall floor garden yard park street road path bridge tower castle palace " +
  "city town village world earth globe planet star stars moon sun sky sunbeam moonlight starlight solar lunar " +
  "space orbit galaxy cosmos nebula comet meteor asteroid rocket shuttle launch flight wing wings fly bird " +
  "fire flame ember blaze ash smoke water wave waves ocean sea river lake pond creek rain storm thunder " +
  "lightning wind breeze gale snow frost ice glacier crystal diamond ruby emerald sapphire pearl opal amber " +
  "gold silver bronze copper iron steel titanium carbon stone rock cliff mountain peak valley canyon desert " +
  "forest woods jungle meadow field prairie island coast beach shore reef coral lagoon harbor bay dock port " +
  "tree trees oak pine maple cedar willow birch palm bamboo fern moss clover leaf leaves root roots seed " +
  "seeds sprout bloom blossom flower rose lily lotus tulip daisy orchid iris poppy sunflower cactus bonsai " +
  // Animals & mythical creatures
  "cat cats dog dogs pup puppy wolf fox bear lion tiger panther jaguar leopard cheetah lynx puma cougar " +
  "eagle hawk falcon owl raven crow swan duck goose robin finch wren crane heron stork parrot macaw toucan " +
  "whale dolphin shark orca seal otter penguin turtle frog toad gecko lizard dragon wyvern phoenix griffin " +
  "unicorn pegasus hydra kraken yeti titan giant elf fairy sprite goblin dwarf wizard mage witch sage monk " +
  "knight king queen prince princess duke baron lord lady hero legend myth fable saga epic quest story " +
  "panda koala sloth llama alpaca camel horse pony mustang stallion zebra giraffe hippo rhino elephant " +
  "monkey ape gorilla chimp lemur raccoon badger ferret beaver squirrel chipmunk rabbit bunny hare mouse " +
  "rat hamster hedgehog deer elk moose bison buffalo bull ox cow goat sheep lamb pig boar bee wasp ant moth " +
  "butterfly dragonfly firefly spider crab lobster shrimp octopus squid jellyfish starfish snail coral " +
  // Food, drinks & flavors
  "coffee espresso latte mocha matcha tea boba chai cocoa chocolate vanilla caramel honey maple syrup sugar " +
  "spice pepper ginger cinnamon mint basil sage thyme clove nutmeg saffron salt sweet sour bitter umami " +
  "apple pear peach plum cherry berry grape lemon lime orange mango papaya guava kiwi fig date coconut " +
  "melon watermelon banana avocado tomato potato carrot onion garlic chili corn wheat oat rice bean pea " +
  "bread toast bagel waffle pancake crepe muffin scone donut cookie cake pie tart brownie fudge candy gum " +
  "pizza pasta ramen udon soba sushi sashimi bento taco burrito nacho salsa curry kebab gyro burger fries " +
  "steak grill bbq roast stew soup salad bowl poke dimsum dumpling bao kimchi tofu tempeh cheese butter " +
  "milk cream yogurt gelato sorbet icecream soda juice cider wine beer ale stout lager rum gin vodka sake " +
  // Art, music, culture & design
  "art arts artist draw paint brush canvas sketch ink print poster mural graff graffiti streetart gallery " +
  "museum statue sculpture craft clay ceramic glass wood paper origami collage mosaic tapestry loom weave " +
  "music song songs beat beats rhythm tempo melody chord note notes bass drum snare kick synth piano organ " +
  "guitar violin cello flute horn sax trumpet harp banjo choir vocal voice opera jazz blues rock punk funk " +
  "soul disco house techno trance rave club dj remix vinyl tape record album track mixtape radio podcast " +
  "film movie cinema video clip reel lens focus camera photo snap shot frame edit cut scene stage theater " +
  "drama comedy magic circus dance ballet tango waltz swing hiphop break freestyle poem poetry prose book " +
  "books page pages novel comic manga zine press news blog journal diary note notes memo letter mail post " +
  // Business, work, commerce & community
  "shop store mart mall bazaar market booth stand cart bag box pack crate drop launch mint claim bid buy " +
  "sell deal deals offer offers sale sales promo coupon discount bonus reward prize gift gifts tip tips " +
  "work job jobs career hire team teams crew squad guild clan tribe club group circle forum board chat " +
  "talk voice call meet room lounge cafe bar pub diner bistro kitchen bakery farm ranch mill forge foundry " +
  "factory workshop garage hangar depot dockyard studio agency firm corp venture capital angel seed grant " +
  "dao treasury escrow ledger audit policy rule rules law court vote ballot poll govern council senate " +
  "brand logo mark sign badge crest seal stamp label tag card pass ticket badge keycard access entry gate " +
  "guide map atlas compass radar beacon torch lantern lamp candle glow beam ray flash prism mirror lens " +
  // Gaming, sports & play
  "game games gamer gaming play player arcade pixel retro level boss quest loot gear item items sword " +
  "shield bow arrow spear axe hammer staff wand armor helm cloak boots ring amulet potion elixir mana " +
  "health score rank tier league cup trophy medal champ champion arena stadium court pitch track ring " +
  "race racing drift turbo nitro boost rally kart bike cycle skate surf ski snow climb hike camp trek " +
  "trail run sprint jump swim dive sail row kayak canoe fish hunt chess poker dice cards deck tarot " +
  "puzzle maze riddle trivia quiz bingo lotto casino spin jackpot win winner victory triumph glory fame " +
  // Science, time, numbers & abstract
  "time clock watch hour minute second epoch era age dawn dusk noon midnight morning evening night today " +
  "tomorrow future past now soon ever always forever eternal infinity limit bound edge center middle " +
  "north south east west up down left right high low deep wide tall fast quick swift rapid slow calm " +
  "cool cold warm hot bright dark light shadow shade clear pure clean fresh crisp smooth sharp soft " +
  "bold brave wild free true real fair just kind wise smart clever sharp keen quick witty funny happy " +
  "joy bliss peace hope love heart soul spirit dream wish luck lucky charm fortune fate destiny karma " +
  "zen aura vibe vibes mood energy force power pulse flux drift shift wave phase spin twist turn loop " +
  "orbit cycle arc curve line dot point plane cube sphere cone torus helix spiral fractal prism spectrum " +
  "color red blue green yellow orange purple violet indigo pink coral teal cyan aqua mint jade lime olive " +
  "gold amber ivory pearl snow slate ash charcoal jet onyx obsidian crimson scarlet ruby cobalt azure navy " +
  // Short names, handles, initials & places
  "max maxi sam alex leo mia kai zoe ava eli noa noah liam emma olivia lucas maya aria ethan luna nova " +
  "ace rex ray jay kay lee dee bee zee tee vee gee eff emm enn ess cue eks wye omar ali omar sara tara " +
  "nina lola coco lulu mimi gigi kiki jojo yoyo bobo toto momo popo dodo fofo soso roro zuzu nunu pipi " +
  "sf nyc la chi mia atx sea pdx den bos phx dal hou atl dmv dc bay silicon valley soho mission castro " +
  "tokyo kyoto osaka seoul taipei singapore sydney london paris berlin zurich lisbon madrid rome milan " +
  "dubai miami austin vegas tahoe malibu venice bali maui kauai oahu ibiza aspen vail banff alps andes " +
  // Action verbs & modern slang
  "go run fly hop skip leap dash rush zoom zip zap pop bam pow boom bang ping pong ding ring sing wing " +
  "make build ship push pull fork merge clone diff patch test check audit scan watch guard shield lock " +
  "unlock open close start stop pause play next prev back home save load copy paste edit draw write read " +
  "send recv swap mint burn stake claim earn win grow scale lift boost super turbo mega giga hyper ultra " +
  "vibe chill flex drip lit fire goat chad based wagmi gm gn hodl moon lambo pump bull bear whale ape " +
  "alpha sigma zen pro vip og dev ops sec ux ui qa pm ceo cto cfo coo vp dir lead chief boss king queen"
).split(/\s+/);

export const SUGGESTION_WORDS = Object.freeze([
  ...new Set([...IDEA_WORDS, ...CURATED_WORD_BANK].filter((w) => /^[a-z0-9]+$/.test(w))),
]);

const SMART_SUFFIXES = ["ai", "pay", "hub", "bot", "lab", "dao", "app", "dev", "art", "io", "xyz", "world", "space"];

const topics = [
 {keys:["moon","star","space","rocket","cosmic","astro","nova","🚀","🌙","🪐"],words:["moonbeam","starlight","orbit","galaxy","cosmos","nebula","comet","astro","lunar"],emoji:["🚀","🌙","🪐","⭐","☄️"]},
 {keys:["sea","ocean","wave","river","water","whale","🌊","🐳"],words:["ocean","coral","tidal","harbor","island","river","pearl","sail","lagoon"],emoji:["🌊","🐳","🐙","🐚","🐠"]},
 {keys:["food","pizza","taco","mango","honey","🍕","🌮"],words:["sushi","taco","mango","honey","noodle","waffle","lemon","peach","olive"],emoji:["🍕","🌮","🍣","🍩","🍑"]},
 {keys:["green","leaf","tree","flower","nature","🌻","🌵"],words:["meadow","bloom","maple","lotus","forest","clover","garden","willow","fern"],emoji:["🌻","🌵","🍀","🌳","🍄"]},
 {keys:["cat","dog","fox","panda","animal","🦊","🐼"],words:["panda","otter","koala","falcon","tiger","llama","zebra","whale"],emoji:["🦊","🐼","🐨","🐯","🦦"]},
 {keys:["ai","bot","agent","code","dev","tech","🤖","⚡"],words:["agent","neural","model","prompt","synth","quantum","vector","nexus","logic"],emoji:["🤖","⚡","🧠","💻","🚀"]},
 {keys:["pay","cash","coin","bank","money","gold","🪙","💎"],words:["vault","wallet","pay","ledger","mint","gold","diamond","treasury","trade"],emoji:["🪙","💎","💰","🏦","⚡"]},
 {keys:["crypto","hodl","rekt","wagmi","ngmi","degen","lambo","fomo","fud","copium","hopium","rugpull","btc","eth","poa","defi","meme","wen","ser","fren","wojak","safu","buidl"],words:["hodl","rekt","wagmi","degen","copium","hopium","lambo","rugpull","bagholder","paperhands","safu","buidl","nocoiner","moonboy","wojak","shill","diamondhands","flippening"],emoji:["🪙","🚀","💎","🐸","🐋","🔥"]},
];

export function ideaPools(query, manifest) {
 const q=String(query??"").toLowerCase().trim().slice(0,128), topic=topics.find(t=>t.keys.some(k=>q.includes(k))), wordSeed=/^[a-z]+$/.test(q)?q.slice(0,48):"", contextual=wordSeed?[wordSeed,...["hub","lab","land","world","garden","house","space"].map(s=>wordSeed+s),...SUGGESTION_WORDS.filter(w=>w.startsWith(wordSeed.slice(0,3)))]:[], words=[...(topic?.words??[]),...contextual,...IDEA_WORDS,...SUGGESTION_WORDS];
 // Full capability catalogue, not a fabricated count or an AI-generation claim.
 const catalogue=manifest?.sequences?Object.values(manifest.sequences):(manifest?.aliases??[]).map(x=>x.canonical);
 let seed=[];try{const n=inspectName(q,manifest);if(n.isRoot&&n.isSingleEmoji)seed=[n.canonical];}catch{}
 const emoji=[...new Set([...seed,...(topic?.emoji??[]),...IDEA_EMOJI,...catalogue])].filter(n=>{try{return inspectName(n,manifest).isSingleEmoji;}catch{return false;}});
 return {words:[...new Set(words)],emoji,related:!!topic||!!seed.length||!!wordSeed};
}

export function createIdeaGenerator({query="",manifest,accept=()=>true}) {
 const pools=ideaPools(query,manifest), positions={words:0,double:0,single:0}, recent={words:[],double:[],single:[]};
 return {related:pools.related,next(lane) {
  const p=lane==="words"?pools.words:pools.emoji, max=lane==="double"?p.length*p.length:p.length;
  if(!max)return null;
  // A finite catalogue rotates forever; only the recent window is excluded, not all past ideas.
  for(let attempt=0;attempt<Math.min(max,12000);attempt++){
   const i=positions[lane]++%max;let name=lane==="double"?p[i%p.length]+p[Math.floor(i/p.length)%p.length]:p[i];
   try{const n=inspectName(name,manifest);name=n.canonical;if(!n.isRoot||(lane==="words"&&(n.emojiCount||!/^[a-z]+$/.test(name)))||(lane==="double"&&(n.tokenCount!==2||n.emojiCount!==2))||(lane==="single"&&!n.isSingleEmoji)||!accept(name)||recent[lane].includes(name))continue;}catch{continue;}
   recent[lane].push(name);if(recent[lane].length>Math.min(20,Math.max(0,p.length-1)))recent[lane].shift();return name;
  }
  return null;
 }};
}

/**
 * Compute inline autofill completion + top available dropdown suggestions for Check Availability.
 * Pure local lookup against the curated word dictionary and registry state; never mutates state.
 */
export function suggestNames(rawQuery, { manifest, accept = () => true, limit = 8, extraWords = [] } = {}) {
 const trimmed = String(rawQuery ?? "").trim();
 if (!trimmed || !manifest) return { completion: "", items: [] };
 const stripped = trimmed.startsWith("poa:") ? trimmed.slice(4) : trimmed;
 if (!stripped || stripped.includes(".")) return { completion: "", items: [] };
 const lower = stripped.toLowerCase();
 const isAsciiPrefix = /^[a-z0-9]+$/.test(lower);
 const wordPool = Array.isArray(extraWords) && extraWords.length
  ? [...new Set([...SUGGESTION_WORDS, ...extraWords.map((w) => String(w ?? "").toLowerCase()).filter((w) => /^[a-z0-9]+$/.test(w))])]
  : SUGGESTION_WORDS;
 const seen = new Set();
 const items = [];
 const tryPush = (candidate, kind = "suggestion") => {
  if (items.length >= limit || !candidate) return false;
  let info;
  try { info = inspectName(candidate, manifest); } catch { return false; }
  if (!info.isRoot || seen.has(info.canonical)) return false;
  if (!accept(info.canonical)) return false;
  seen.add(info.canonical);
  items.push({ name: info.canonical, tier: info.tier, isSingleEmoji: info.isSingleEmoji, kind });
  return true;
 };

 // 1. If exact typed text is valid and available, put it first.
 const exactAdded = tryPush(stripped, "exact");

 // 2. Prefix matches from the massive curated dictionary (prefer shorter obvious words first).
 let completion = "";
 if (isAsciiPrefix) {
  const prefixMatches = wordPool
   .filter((w) => w.startsWith(lower) && w !== lower)
   .sort((a, b) => a.length - b.length || a.localeCompare(b));
  for (const w of prefixMatches) {
   if (tryPush(w, "prefix") && !completion) completion = w;
   if (items.length >= limit) break;
  }
  // If user typed a full dictionary word, check if there's a natural completion only when not exact
  if (!completion && !exactAdded) {
   const sub = wordPool.filter((w) => w.includes(lower) && !w.startsWith(lower))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
   for (const w of sub) {
    if (tryPush(w, "match") && !completion) completion = w;
    if (items.length >= limit) break;
   }
  }
  // 3. Topic matches & smart compound suffixes (e.g. maxai, maxpay, maxhub)
  if (items.length < limit) {
   const topic = topics.find((t) => t.keys.some((k) => lower.includes(k) || k.startsWith(lower)));
   if (topic) {
    for (const w of topic.words) {
     tryPush(w, "topic");
     if (items.length >= limit) break;
    }
   }
  }
  if (items.length < limit && lower.length >= 2 && lower.length <= 20) {
   for (const suf of SMART_SUFFIXES) {
    tryPush(lower + suf, "compound");
    if (items.length >= limit) break;
   }
  }
 } else {
  // Emoji or mixed query: suggest related emoji & topic words
  const pools = ideaPools(stripped, manifest);
  for (const e of pools.emoji) {
   tryPush(e, "emoji");
   if (items.length >= limit) break;
  }
  for (const w of pools.words) {
   tryPush(w, "topic");
   if (items.length >= limit) break;
  }
 }

 return { completion, items };
}
