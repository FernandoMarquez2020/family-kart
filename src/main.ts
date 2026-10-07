import { CHARACTERS, getCharacter } from './characters/CharacterSpec';
import { Game } from './core/Game';
import { DEFAULT_CONFIG, MODES, type GameMode, type RaceConfig } from './core/GameConfig';
import { pointsFor, type RaceResult } from './race/RaceDirector';
import { Intro } from './ui/Intro';
import { Menu } from './ui/Menu';
import { Options } from './ui/Options';
import { Results, type StandingRow } from './ui/Results';
import { TouchControls } from './ui/TouchControls';
import { Lobby, roomFromUrl } from './ui/Lobby';
import { PeerTransport } from './net/PeerTransport';
import { LocalTransport } from './net/Transport';
import type { Session } from './net/Session';
import { shouldShowTouch, type ControlPrefs } from './core/Controls';
import * as showcase from './showcase/Showcase';
import type { Difficulty } from './race/AiDriver';

const params = new URLSearchParams(location.search);

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const backBtn = document.getElementById('back-btn');
if (!canvas || !backBtn) throw new Error('Falta algún elemento base del documento');

const menu = new Menu(document);
const results = new Results(document);
const touch = new TouchControls(document);
const options = new Options(document);
const lobby = new Lobby(document);

let game: Game | null = null;
/** La partida en red en curso, o null si se está jugando solo. */
let session: Session | null = null;

/** Estado del torneo en curso, o null si no hay uno. */
interface Tournament {
  config: RaceConfig;
  /** Pistas a correr, en orden. */
  trackIds: string[];
  index: number;
  points: Map<string, number>;
}
let tournament: Tournament | null = null;

// --- Arranque de una carrera -----------------------------------------------

function startRace(config: RaceConfig): void {
  game?.dispose();
  results.hide();
  menu.close();
  backBtn!.classList.remove('hidden');

  game = new Game(canvas!, config);
  // En red, la sesión se engancha ANTES de largar: si se enganchara después, los
  // karts de los invitados arrancarían manejados por la máquina y se verían
  // arrancar solos hasta que llegue el primer paquete.
  session?.attach(game);
  game.onNetTick = (dt) => session?.update(dt);
  game.onRaceFinished = (raceResults) => finishRace(raceResults, config);
  applyControls(options.current);
  options.setAvailable(true);
  game.start();

  const label = tournament
    ? `Carrera ${tournament.index + 1} de ${tournament.trackIds.length} · ${game.trackName}`
    : game.trackName;
  game.hud.flash(label, 2.4);

  // Punto de entrada para los tests automatizados y la consola.
  (window as unknown as Record<string, unknown>).__kart = game;
}

function beginTournament(config: RaceConfig): void {
  tournament = {
    config,
    trackIds: CHARACTERS.map((c) => c.id),
    index: 0,
    points: new Map(),
  };
  startRace({ ...config, trackCharacterId: tournament.trackIds[0] });
}

function start(raw: RaceConfig): void {
  // La contrarreloj es siempre en solitario, se haya elegido lo que se haya
  // elegido antes de cambiar de modo.
  const config: RaceConfig = raw.mode === 'contrarreloj' ? { ...raw, racerCount: 1 } : raw;
  if (config.mode === 'torneo') beginTournament(config);
  else {
    tournament = null;
    startRace(config);
  }
}

// --- Fin de carrera ---------------------------------------------------------

function finishRace(raceResults: RaceResult[], config: RaceConfig): void {
  // Dejamos correr unos segundos la vuelta de honor antes de tapar la pista.
  window.setTimeout(() => showResults(raceResults, config), 2600);
}

function showResults(raceResults: RaceResult[], config: RaceConfig): void {
  const trackName = game?.trackName ?? '';

  if (!tournament) {
    const mine = raceResults.find((r) => r.isPlayer);
    results.onPrimary = () => start(config);
    results.onMenu = backToMenu;
    results.showRace({
      title: config.mode === 'contrarreloj' ? 'Contrarreloj' : 'Resultado',
      subtitle:
        config.mode === 'contrarreloj'
          ? `${trackName} · mejor vuelta ${mine ? formatBest(mine) : '—'}`
          : trackName,
      results: raceResults,
      primaryLabel: 'CORRER DE NUEVO',
    });
    return;
  }

  // --- Torneo: sumar puntos y encadenar con la siguiente pista ---
  for (const r of raceResults) {
    tournament.points.set(r.name, (tournament.points.get(r.name) ?? 0) + pointsFor(r.position));
  }

  const standings = buildStandings(tournament, raceResults);
  const isLast = tournament.index >= tournament.trackIds.length - 1;

  results.onMenu = backToMenu;
  results.onPrimary = () => {
    if (!tournament) return;
    if (isLast) {
      tournament = null;
      backToMenu();
      return;
    }
    tournament.index++;
    startRace({
      ...tournament.config,
      trackCharacterId: tournament.trackIds[tournament.index],
    });
  };

  results.showRace({
    title: isLast ? 'Torneo terminado' : `Carrera ${tournament.index + 1}`,
    subtitle: trackName,
    results: raceResults,
    primaryLabel: isLast ? 'VOLVER AL MENÚ' : 'SIGUIENTE CARRERA',
    standings,
  });
}

function buildStandings(t: Tournament, raceResults: RaceResult[]): StandingRow[] {
  const playerName = raceResults.find((r) => r.isPlayer)?.name ?? '';
  return [...t.points.entries()]
    .map(([name, points]) => ({ name, points, isPlayer: name === playerName }))
    .sort((a, b) => b.points - a.points);
}

function formatBest(result: RaceResult): string {
  const seconds = result.bestLap;
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

// --- Navegación -------------------------------------------------------------

function backToMenu(): void {
  options.toggle(false);
  options.setAvailable(false);
  touch.setVisible(false);
  document.body.classList.remove('touch-on');
  game?.dispose();
  game = null;
  tournament = null;
  session?.close();
  session = null;
  lobby.close();
  (window as unknown as Record<string, unknown>).__kart = undefined;
  results.hide();
  backBtn!.classList.add('hidden');
  menu.open('modo');
}

// --- Controles --------------------------------------------------------------

/** Aplica el esquema de teclado y los botones táctiles a la carrera en curso. */
function applyControls(prefs: ControlPrefs): void {
  if (!game) {
    touch.setVisible(false);
    return;
  }
  game.input.setLayout(prefs.layout);
  game.input.setTouchSource(touch.state);
  const showTouch = shouldShowTouch(prefs);
  touch.setVisible(showTouch);
  // Con los botones en pantalla, el HUD se reacomoda para no quedar debajo.
  document.body.classList.toggle('touch-on', showTouch);
}

options.onChange = applyControls;
options.onExit = backToMenu;
// Las opciones pausan de verdad: cambiar de teclado mientras el kart sigue
// andando es la forma más rápida de terminar contra el muro.
options.onToggle = (open) => {
  if (open) {
    touch.reset();
    game?.stop();
  } else {
    game?.start();
  }
};
menu.onControlsChange = applyControls;

backBtn.addEventListener('click', backToMenu);
menu.onStart = start;

// --- Modo online ------------------------------------------------------------

/**
 * Abre una sala.
 *
 * `local` usa el canal entre pestañas en lugar de salir a internet. Sirve para
 * dos jugadores en la misma computadora, y es lo que usan los tests para poder
 * comprobar la sincronización sin depender de una conexión.
 */
function openLobby(room: string | null, local = false): void {
  menu.close();
  backBtn!.classList.remove('hidden');
  lobby.open(room, 'Jugador', (code) =>
    local ? new LocalTransport(code) : new PeerTransport(code, room === null),
  );
}

lobby.onCancel = backToMenu;
lobby.onStart = (active) => {
  session = active;
  // Todos corren la MISMA pista: la configuración la fija el anfitrión y viaja
  // con el aviso de largada. Si cada uno usara la suya, correrían circuitos
  // distintos creyendo que están juntos.
  const config = {
    ...menu.current,
    mode: 'carrera' as const,
    racerCount: Math.max(2, menu.current.racerCount),
  };
  active.go(config);
  lobby.handOff();
  start(config);
};

lobby.onGo = (active, config) => {
  session = active;
  start(config as RaceConfig);
};
menu.onOnline = () => openLobby(null);
menu.open('modo');
menu.updateControlLegend();

// Alguien abrió un link de invitación: entra directo a esa sala.
const invited = roomFromUrl();
if (invited) openLobby(invited, params.has('local'));

// --- Presentación -----------------------------------------------------------
// El menú se arma primero y queda por debajo: al terminar la portada ya está
// listo, sin el parpadeo de una pantalla que se construye recién ahí.
// El que llega por un link de invitación viene a jugar a una partida que ya
// está armada: la presentación le taparía la sala y lo dejaría esperando.
if (!params.has('autostart') && !params.has('showcase') && !params.has('sala')) {
  const intro = new Intro(document);
  intro.show();
}

// --- Renders de presentación ------------------------------------------------
// Sólo lo usa `scripts/build-figures.mjs`. Va como import estático y no
// dinámico porque el juego se publica como un único HTML: un `import()` parte el
// bundle en dos y el segundo trozo no existe en el archivo publicado.
(window as unknown as Record<string, unknown>).__showcase = showcase;

// --- Arranque directo por URL ----------------------------------------------
// Sirve para el test de humo y para compartir una partida por link:
// `?c=bloques&mode=carrera&racers=4&dif=normal&laps=2&autostart=1`
if (params.get('autostart') === '1') {
  const characterId = params.get('c') ?? params.get('character') ?? DEFAULT_CONFIG.characterId;
  const mode = (params.get('mode') as GameMode) ?? 'carrera';
  const config: RaceConfig = {
    ...DEFAULT_CONFIG,
    mode: MODES[mode] ? mode : 'carrera',
    characterId: getCharacter(characterId).id,
    trackCharacterId: getCharacter(params.get('track') ?? characterId).id,
    racerCount: Number(params.get('racers') ?? DEFAULT_CONFIG.racerCount),
    difficulty: (params.get('dif') as Difficulty) ?? DEFAULT_CONFIG.difficulty,
    laps: Number(params.get('laps') ?? DEFAULT_CONFIG.laps),
  };
  start(config);
}
