# Family Kart

Kart racer 3D en el navegador con los pilotos de la familia: cada uno corre con
su cara —la foto real, recortada y puesta sobre el modelo— en su propio vehículo
y su propia pista. Más adelante, carreras online.

Hecho con TypeScript, Three.js y Vite. Sin motor de juego: la física, la pista y
el control de carrera son propios, para poder hacerlos deterministas y
reutilizarlos en el servidor cuando llegue el multijugador.

## Estado

**Hito 1 — el manejo.** Es lo primero porque todo lo demás se cuelga de acá: si
manejar no se siente bien, ni los personajes ni el online lo salvan.

- Física arcade de kart: aceleración, frenado, reversa, dirección dependiente de
  la velocidad, deslizamiento lateral con agarre variable.
- Derrape con saltito, mini turbo en tres niveles y turbo al soltar. Parte del
  deslizamiento se recicla en avance, así que derrapar es más rápido que no
  hacerlo.
- Vueltas, sectores en orden (no se puede cortar camino), cronómetro con mejor
  vuelta y última vuelta.
- Penalización fuera de pista, barrera exterior, detección de contramano y
  respawn.
- Cámara persecutoria con retraso en el derrape y FOV que se abre con la
  velocidad. HUD con velocímetro, vueltas, tiempos y carga del mini turbo.
- Teclado y joystick.

**Hito 2 — personajes y mundos.** Seis pilotos, cada uno con su cara real, su
vehículo y su pista temática:

| Piloto | Vehículo | Pista |
| --- | --- | --- |
| Isma | kart rojo, número 7 | **Estadio Mundial 26** — césped rayado, tribunas llenas, arcos con red, torres de luz, banderas y vallas |
| Xavi | kart oscuro con neón, número 2 | **Circuito Neón** — noche, grilla luminosa, píxeles flotando |
| Benja | kart celeste y blanco, número 10 | **Ciudad Bloques** — todo cúbico y saturado |
| Isa | kart rosa, número 4 | **Valle Rosa** — flores gigantes, globos y castillos pastel |
| Fer | **autoelevador** verde con uñas, número 1 | **Terminal Puerto** — grúas pórtico, pilas de contenedores, muelle y buques amarrados sobre el agua |
| Vero | **deportivo** rojo, número 8 | **Costanera Miami** — playa, palmeras y sombrillas de un lado; edificios art déco, marquesinas y neones del otro |

**Las caras son las fotos de verdad.** `scripts/landmarks.py` detecta los 68
puntos de cada cara con dlib y `scripts/build-photos.py` arma la textura a
partir de ellos. Los landmarks resuelven dos cosas que antes se hacían a ojo y
salían mal:

- **El alineado.** Las pupilas medidas fijan escala y rotación. Leerlas a mano
  sobre una grilla parece exacto y no lo es: en una cara girada el ojo más lejano
  se lee corrido, y ese error se multiplica por la escala hasta mover la cara
  media frente.
- **El recorte.** La máscara sigue el **contorno real** de cada mandíbula, no una
  forma fija y simétrica. Una forma simétrica sobre una cara de tres cuartos
  sobra de un lado —entra fondo— y falta del otro —corta el pómulo—. Con el
  contorno medido, las caras giradas de Benja y Vero se recortan igual de
  limpias que las de frente.

Alrededor del rostro la textura **no** queda transparente ni rellena de un color
plano: la piel del borde se estira hacia afuera con una pirámide de empujar y
tirar, y se apaga hacia un tono liso justo en el filo del casquete. Es lo que
hace que no se vea dónde termina la foto y empieza la cabeza — con un color
plano se ve el escalón, y con transparencia se ve el aro.

Las seis fotos además se **balancean entre sí**: se separa el tinte de la luz
—que es del ambiente y hay que sacarlo— de la luminosidad de la piel —que es de
la persona y hay que dejarla—, así que se va el naranja de la lámpara de Isma y
el lavado de la ventana de Vero sin que Fer deje de ser más tostado ni Benja más
claro.

**Las cabezas tienen forma de cabeza.** `shapeHead` deforma los vértices del
cráneo y del casquete de la cara con la *misma* función, que es lo que los
mantiene concéntricos: mandíbula que se afina hacia abajo (mucho más en ancho que
en fondo), nuca plana, mentón hacia adelante y cráneo un poco más alto que ancho.
Antes eran esferas escaladas, y en una esfera la mandíbula mide lo mismo que la
frente — con eso sólo ya se lee muñeco. El pelo se corta por una **línea de
nacimiento** y no por un paralelo de la esfera: alta en el medio de la frente,
baja por las sienes hasta adelante de las orejas y más baja todavía en la nuca.

La cabeza va un 34 % más grande que a escala real: es la proporción clásica del
kart racer y acá tiene una razón extra, porque el juego se mira desde atrás y de
lejos, y con una cabeza realista los rasgos de la foto ocupan cuatro píxeles.

Debajo sigue viva la cara dibujada por código, a partir de parámetros —tono de
piel, color y peinado, volumen del pelo, mechas, flequillo, color y forma de los
ojos, pestañas, cejas, labios, vello facial, ancho de cara y de nariz,
proporciones de adulto o de chico, patrón de remera, expresión y escala—. Es lo
que se ve mientras la foto termina de decodificar, y lo que usaría un personaje
nuevo que todavía no tenga foto.

La cara no es un dibujo plano de cuatro trazos: lleva sombreado de piel
recortado con una máscara ovalada, ojos almendrados con iris de fibras radiales,
anillo de limbo y dos brillos, cejas dibujadas pelo por pelo, nariz con sombra
de lomo y fosas, y labios con arco de Cupido. El material de la cara es Lambert
y no Basic a propósito: recibe la misma luz que el cráneo, así que en la pista
nocturna no queda una cara a pleno brillo pegada sobre una cabeza en penumbra.

No todos manejan un kart. Cada carrocería (`src/kart/chassis.ts`) devuelve la
misma ficha —dónde van las ruedas y de qué tamaño, dónde se sienta el piloto,
dónde se pegan las chapas del número, de dónde sale la llama del turbo— así que
el resto del juego no sabe qué está manejando cada uno. **Todas comparten la
física**: un autoelevador que anduviera distinto sería un castigo para quien lo
elija.

La cara va sobre un casquete curvo pegado al cráneo, no sobre un plano: un plano
tangente pelea por el mismo Z que la esfera de la cabeza y deja un recuadro
visible, y adelantarlo lo despega de costado. El pelo va en dos piezas —corona y
nuca— con el hueco del frente más ancho que la cara, para que no se la coma por
los costados. Ese casquete es donde entra después la caricatura dibujada de cada
uno, vía `KartView.setFaceTexture()`.

Los nombres se editan en el menú y quedan guardados en el navegador.

**Hito 3 — modos, rivales y poderes.**

Tres modos, elegibles desde el menú:

- **Contrarreloj** — solo en la pista que elijas, a bajar la mejor vuelta.
- **Carrera** — una carrera contra rivales en la pista que elijas.
- **Torneo** — una carrera en cada una de las seis pistas, con puntaje
  acumulado (10, 8, 6, 5…). El menú encadena las carreras y muestra la tabla.

En carrera y torneo se elige la cantidad de karts (2, 4, 6 u 8), la dificultad
(fácil, normal, difícil) y las vueltas. Si se piden más karts que personajes
hay, se generan variantes con la librea en otro tono y otro número.

Cada pista tiene **3 rampas de turbo** y **2 puntos con cajas de poder** (tres
cajas por punto, para que entren varios karts). La caja estalla en pedazos al
agarrarla y vuelve a aparecer creciendo unos segundos después. Los poderes:

| Poder | Qué hace |
| --- | --- |
| 🍌 Banana | Queda en la pista detrás tuyo. El que la pisa se va de trompo. |
| 🔥 Bola de fuego | Sale derecho para adelante, con núcleo, envoltura que late y estela de brasas. |
| 🚀 Misil | Persigue al kart que va adelante tuyo en la clasificación, **siguiendo el trazado**. |
| ⚡ Rayo | Vas más rápido y ningún poder te afecta. |

El sorteo de la caja mira la posición: al que va último le salen más seguido los
poderes fuertes. Es lo que mantiene la carrera pareja entre chicos de distinta
edad. En contrarreloj las cajas dan siempre el rayo, que es el único que sirve
corriendo solo.

El misil no apunta al objetivo en línea recta: eso lo mandaba contra el muro
exterior en cuanto había una curva de por medio. Apunta a un punto de la línea
central por delante suyo, corrido hacia el carril del objetivo, y sólo cuando lo
tiene a menos de diez metros se tira de lleno sobre él. Los dos proyectiles
siguen además el relieve del circuito en vez de irse al cielo en una bajada, y
revientan en una explosión al impactar o al chocar el muro.

**Hito 4 — presentación: el afiche.**

Al abrir, el juego se presenta como un cartel de película: el reparto son las
seis **personas reales**, recortadas de sus fotos, y los seis vehículos van en un
friso arriba. Se saltea con cualquier tecla o toque: una portada que no se puede
saltear se odia a la segunda vez.

Son dos piezas distintas a propósito. Los personajes 3D son para la pista, donde
hay que reconocer a alguien de atrás y a cuarenta metros. El afiche es para que
alguien quiera jugar, y ahí una cara de verdad hace lo que un modelo no hace.

Los retratos los arma `scripts/build-portraits.py`: el recorte lo hace una red de
segmentación (rembg / u2net), que es lo único que separa bien el pelo del fondo
—con umbral de color o GrabCut, los rulos de Isma y las mechas de Vero salen
comidos—, y encima va el tratamiento de afiche: curva de contraste, sombras
frías y luces cálidas, luz de contorno sacada de la propia silueta, y el pie
desvanecido para que el personaje parezca salir de la oscuridad en vez de estar
recortado. El borde donde se termina la **foto** (no la persona) también se
difumina: en varias el encuadre corta al chico por el hombro, y sobre el afiche
oscuro esa línea recta se ve como un rectángulo pegado alrededor.

El encuadre sale de los mismos landmarks que la cara del juego, así que las seis
cabezas quedan del mismo tamaño y a la misma altura aunque las fotos estén
sacadas a distancias muy distintas. La fila va en cuña —los del medio más grandes
y adelante, los de las puntas más chicos y atrás— porque seis retratos iguales en
línea recta se leen como un catálogo, y entran desde las puntas hacia el centro
para que el remate quede en el medio y no en un borde.

Las figuras no son capturas del juego ni una escena 3D montada en el arranque:
son renders hechos **fuera de línea** por `scripts/build-figures.mjs`, que abre
el juego en Chromium y le pide a `src/showcase/Showcase.ts` la misma geometría
pero fotografiada en un estudio —materiales PBR con reflejos de entorno, luz de
recorte, sombra de contacto blanda y 900 px por figura—. El juego en pista sigue
siendo liviano y la portada se ve como una foto de producto. Los seis renders y
el fondo quedan embebidos en `src/ui/figures.ts`, así que la presentación aparece
al instante.

Esas mismas figuras quedan después en el menú: la parrilla completa arriba del
primer paso y el vehículo de cada piloto en su tarjeta.

**Hito 5 — mapa, controles y pantalla táctil.**

- **Minimapa** translúcido arriba a la derecha: el trazado se dibuja una sola vez
  en un canvas de fondo y encima sólo se repintan los puntitos. El jugador es un
  triángulo que apunta hacia donde mira, los rivales son círculos del color de su
  kart, y las bananas y los proyectiles también aparecen.
- **Cuatro esquemas de teclado** (flechas, WASD, ZQSD para AZERTY, IJKL),
  elegibles antes de la carrera y en plena carrera con `Esc` o el ⚙. Las opciones
  **pausan de verdad**: probar controles nuevos mientras el kart sigue andando es
  la forma más rápida de terminar contra el muro.
- **Botones táctiles** para celular y tablet: discretos, de vidrio, con captura
  de puntero para que el kart no se quede acelerando solo si el dedo se corre. Se
  muestran solos en pantallas táctiles y se pueden forzar o apagar.

**Hito 6 — modo en red (en curso).**

Partida punto a punto, sin servidor: el que abre la sala pasa un link y los demás
entran con sólo abrirlo. El código de sala va en la dirección (`?sala=abc123`)
justamente para eso — invitar es mandar un link, no dictar un código.

Manda el anfitrión: **una sola máquina simula** y las demás le mandan lo que
están apretando y reciben de vuelta dónde quedó todo. La alternativa (que todos
simulen lo mismo y coincidan) da menos tráfico, pero cualquier diferencia mínima
entre navegadores desincroniza la partida sin aviso y es carísima de perseguir.
Con un solo simulador no hay nada que pueda divergir.

Aun así, el invitado simula su propio kart con sus teclas sin esperar respuesta:
si esperara la confirmación para moverse, entre apretar y ver el kart arrancar
pasaría el viaje de ida y vuelta completo. Las fotos del anfitrión corrigen a los
demás karts, nunca al propio.

Lo que lo hizo posible fue separar **quién es un corredor** de **quién lo
maneja** (`src/net/Controller.ts`). Antes el bucle preguntaba `racer.isPlayer` y
elegía entre el teclado y la IA; un tercer origen no tenía dónde entrar sin meter
condicionales de red en el medio de la física. Ahora el teclado, la máquina y la
red son tres implementaciones de lo mismo y el bucle no sabe cuál le tocó.

Dos transportes detrás de la misma interfaz: WebRTC para jugar a distancia, y un
canal entre pestañas de la misma computadora (`?local=1`) que es el que usan los
tests. Probando por ahí, la prueba no depende de que haya internet ni de que un
servicio externo esté vivo, y cuando algo falla en una partida real se sabe de
entrada si el problema es el juego o la conexión.

Todavía no: torneos en red, y el chat.

**Hito 6 — rostros, cabezas y afiche.** Reescritura del pipeline de caras sobre
landmarks, rediseño de las cabezas 3D y la presentación como cartel de película.
Está contado arriba, en *Pistas y personajes* y en el hito 4.

**Hito 7 — caras de frente.** Las fotos estaban sacadas con la cabeza en seis
posiciones distintas, y alinear por las pupilas arregla la inclinación pero no
el GIRO: una cara de tres cuartos sigue siéndolo, y puesta sobre una cabeza que
mira al frente se lee torcida. Ahora se endereza en dos pasos. **Simetrizar
endereza**: una cara de frente es casi simétrica y una girada no, así que
cruzando el contorno medido con su propio espejo el giro se cancela — sin
estimar ángulos ni modelos 3D. **Mezclar con la forma media homogeneiza**: con
las seis ya de frente se promedian sus formas y cada una se lleva parte del
camino hacia ese promedio, así que los seis terminan con los ojos, la nariz y la
boca en el mismo lugar sin dejar de reconocerse. La foto se deforma con un warp
por triángulos.

Dos detalles que decidieron el resultado. Al simetrizar se toma el punto **más
lejano** al eje y no el promedio: el lado que se aleja de la cámara está
escorzado, y promediarlo achica la cara — aplicado a las seis, arrastra el
promedio y salen todas más flacas. Y la mitad que la foto no muestra se rellena
con su reflejo, pero **empezando pasado el ojo**: arrancando en el eje, el ojo
bueno se superpone al otro y queda un ojo fantasma.

Todavía no: torneos en red, chat.

## Publicarlo en la web

**Alcanza con GitHub Pages. No hace falta Firebase ni ningún servidor.**

El juego compila a archivos estáticos y el modo en red es punto a punto, así que
no hay backend que hostear: el `.github/workflows/deploy.yml` ya compila y
publica en cada push a `main`. Sólo falta activar Pages en el repositorio
(*Settings → Pages → Source: GitHub Actions*).

Firebase tendría sentido para otra cosa —cuentas, un listado de salas abiertas,
tiempos guardados, un ranking entre todos— pero nada de eso hace falta para
jugar.

### Lo único que puede necesitar plata algún día

Dos navegadores no se encuentran solos: alguien tiene que presentarlos. De eso
se ocupan dos servicios distintos, y conviene no confundirlos.

- **La presentación** (el *signalling*) la hace el broker público de PeerJS.
  Gratis, sin cuenta, y sólo interviene en el saludo inicial. Ya está
  configurado.
- **STUN** le dice a cada uno con qué dirección se lo ve desde afuera. Gratis e
  ilimitado (Cloudflare y Google). Ya está configurado. **Con esto alcanza para
  la mayoría de las conexiones entre dos casas.**
- **TURN** hace de intermediario permanente, y hace falta sólo cuando alguno de
  los dos está detrás de un NAT que le cambia el puerto según con quién hable —
  típico de las conexiones móviles y de los proveedores que comparten una IP
  entre muchos clientes. Como relaya todo el tráfico, no hay ninguno realmente
  abierto. Está **preparado y vacío** en `src/net/PeerTransport.ts`: mientras no
  haga falta, no se paga ni se configura nada.

La sala dice en qué paso está la conexión y, cuando se arma, si salió
**directa** o **por intermediario**. Esa es la señal: si nunca aparece
"intermediario", el TURN no hace falta. Si una partida se queda en "Buscando la
sala…", ahí sí.

### Las fotos no van al repositorio

`fotos/` está en el `.gitignore` a propósito. El juego no las necesita para
compilar —usa las texturas ya recortadas, que están generadas y versionadas— y
los originales son de cuerpo entero y a resolución completa. En un repositorio
público quedarían a la vista sin sumarle nada al juego.

Para regenerar las caras hay que tener `fotos/` en local; el README explica los
pasos más arriba. Y vale tenerlo presente: **en una página pública, cualquiera
con el link ve a los chicos**. Si eso no se quiere, las alternativas son un repo
privado con Pages (requiere plan pago) o un hosting con contraseña.

## Cómo correrlo

```bash
npm install
npm run dev      # http://localhost:5173
```

Las caras y la portada están generadas y versionadas, así que no hace falta
rehacerlas para jugar. Si cambian las fotos o los vehículos (los dos primeros
pasos necesitan `dlib` y `rembg`, y el tercero además descarga el modelo de
segmentación la primera vez):

```bash
python3 scripts/landmarks.py         # fotos/ → scripts/landmarks.json (68 puntos)
python3 scripts/build-photos.py      # → src/characters/photos.ts (caras del juego)
python3 scripts/build-portraits.py   # → src/ui/portraits.ts (retratos del afiche)
npm run build && node scripts/build-figures.mjs   # renders → src/ui/figures.ts
```

Build de producción:

```bash
npm run build
npm run preview
```

## Controles

| Acción | Teclado | Joystick |
| --- | --- | --- |
| Acelerar | `↑` | Gatillo derecho o `A` |
| Frenar / reversa | `↓` | Gatillo izquierdo o `B` |
| Doblar | `←` `→` | Stick izquierdo |
| Saltar y derrapar | `Espacio` | Gatillos superiores |
| Usar el poder | `Shift` / `Enter` / `X` | `X` o `Y` |
| Volver a la pista | `R` | `Start` |
| Opciones | `Esc` o el ⚙ | — |

Ése es el esquema de flechas, que es el de fábrica. En el último paso del menú
—y en las opciones, en plena carrera— se puede cambiar a **WASD**, **ZQSD**
(AZERTY) o **IJKL**. El mapa de teclas usa `KeyboardEvent.code`, o sea la
posición física de la tecla, así que el esquema es el mismo sin importar la
distribución que tenga configurado el sistema operativo.

En celular o tablet aparecen solos unos botones en pantalla: los dos de doblar a
la izquierda, y acelerador, freno, derrape y poder a la derecha.

Para derrapar: entrás a la curva, apretás `Espacio` para dar el saltito y lo
mantenés mientras doblás. La barra de abajo a la derecha muestra la carga;
cuando cambia de color, al soltar te llevás el turbo.

El botón de arriba a la derecha vuelve a la selección de piloto.

## Pistas y personajes

Un circuito es sólo un `TrackSpec`: radio, armónicos de curvatura y de
elevación, ancho, peralte, tema visual, vueltas y checkpoints. El trazado se
genera con una curva radial `r(θ) = R · (1 + Σ aᵢ·sin(fᵢθ + pᵢ))` a partir de una
semilla de texto: mientras `Σ|aᵢ| < 1` el radio nunca se anula, así que el
circuito es siempre una curva cerrada simple —no se cruza a sí misma— y no hace
falta validarlo después. La misma semilla da siempre el mismo trazado.

Un tema (`src/track/themes.ts`) es una paleta: colores de asfalto, pianos,
suelo, cielo, niebla y luz, más qué familia de decorados poblar. Agregar un
mundo nuevo es agregar una entrada ahí; no hay que tocar la pista ni la física.

La barrera exterior es un muro visible —vallas, guardarraíl, cerco— dibujado a
la distancia exacta que usa la física (`BARRIER_OFFSET`, en `TrackSpec.ts`).
Vive en un único lugar a propósito: cuando sólo la sabía la física, el kart
rebotaba contra una pared invisible y parecía un bug.

Lo mismo con el perfil de la banquina (`shoulderLift`): lo usan la malla del
terreno, el muro, los decorados **y la física**. Cuando la física no lo sabía,
el kart salía de la pista y quedaba flotando sobre el pasto, porque seguía
usando el plano del asfalto prolongado mientras el terreno ya había bajado.

Un personaje (`src/characters/CharacterSpec.ts`) junta apariencia del piloto,
librea del kart y a qué pista está vinculado. También son sólo datos.

Se puede entrar directo a un piloto por link:

```
index.html?c=bloques&autostart=1
```

## Estructura

```
src/
  core/
    Game.ts          Orquestación, render loop y paso fijo de simulación
    GameConfig.ts    Modos y opciones de partida
    Input.ts         Teclado + joystick + táctil unificados, con override inyectable
    Controls.ts      Esquemas de teclado y preferencias de control
  characters/
    CharacterSpec.ts Los 6 personajes: apariencia, vehículo, pista y nombres
    faces.ts         Cara dibujada, pelo y orejas 3D, retrato y chapa del número
    photos.ts        Las fotos reales ya recortadas (generado, no editar a mano)
  track/
    themes.ts        Paletas y decorados de cada mundo
    TrackSpec.ts     Definición de circuito, generador y medidas compartidas
    TrackPath.ts     Línea central muestreada, consultas espaciales y proyección
    TrackMesh.ts     Asfalto, pianos, banquinas, muro perimetral y meta
    scenery.ts       Props instanciados de cada tema
    textures.ts      Texturas generadas por canvas (sin assets externos)
  kart/
    KartPhysics.ts   Física arcade determinista, con los efectos de los poderes
    KartView.ts      Piloto, ruedas y efectos, sobre la carrocería que toque
    chassis.ts       Kart, autoelevador y deportivo, con la misma ficha de montaje
  items/
    ItemTypes.ts     Los cuatro poderes y el sorteo por posición
    Pickups.ts       Rampas de turbo y cajas, colocadas por `t` del trazado
    ItemSystem.ts    Recogida, guiado de los proyectiles y colisiones
    Projectiles.ts   Aspecto de los proyectiles: estelas y explosiones
  race/
    Racer.ts         Un kart en carrera: física, modelo, vueltas y poder
    LapTracker.ts    Sectores, vueltas y cronómetro de un kart
    RaceDirector.ts  Cuenta regresiva, posiciones y llegada
    AiDriver.ts      Piloto automático de los rivales y las 3 dificultades
    Grid.ts          Parrilla de largada y variantes de personaje
  showcase/
    Showcase.ts      Renders de portada en calidad de estudio (sólo para el build)
  ui/
    Intro.ts         Presentación animada
    figures.ts       Los renders de portada embebidos (generado, no editar)
    Menu.ts          Menú por pasos
    Options.ts       Pausa y opciones de control en plena carrera
    TouchControls.ts Botones en pantalla para celular y tablet
    Results.ts       Clasificación y tabla del torneo
  view/
    ChaseCamera.ts   Cámara persecutoria
    Hud.ts           HUD en DOM
    Minimap.ts       Minimapa translúcido en canvas 2D
    Sky.ts           Domo de cielo
```

### La convención de "derecha"

Hay una trampa que ya costó un bug de dirección invertida y vale tenerla clara.
En un mundo con **Y hacia arriba y orientación derecha** —el de Three.js—, el
costado derecho de algo que mira en dirección `F` es:

```
derecha = F × arriba          // NO  arriba × F
```

`arriba × F` da el costado **izquierdo**. El error es silencioso: si se usa en
todos lados, el juego queda internamente coherente —el peralte, la IA y las
colisiones funcionan— pero espejado, y recién se nota porque al apretar la
flecha derecha el kart se va a la izquierda de la pantalla.

Dos consecuencias que conviene recordar:

- El eje **+X local de un modelo** que mira a +Z apunta a su **izquierda**. Es
  lo correcto: es lo que hace que la base sea derecha (X × Y = Z) y el modelo no
  salga espejado. `KartView` lo llama `localX` justamente para no confundirlo.
- En la convención de Three.js el **yaw crece girando a la izquierda**, así que
  el comando de volante va con signo cambiado respecto del error de rumbo. Para
  no equivocarlo, todo el que apunte el kart hacia algún lado usa
  `steerToward(rumboActual, rumboDeseado)`, que devuelve el volante ya con el
  signo bueno.

El test de humo lo verifica **contra la pantalla**: proyecta la posición del
kart con la cámara del jugador y comprueba de qué lado del cuadro termina.
Comprobarlo contra los vectores internos no sirve de nada, porque si el vector
está invertido la comprobación también lo está.

### El acelerador pide una velocidad, no una fuerza

Durante un tiempo el motor empujaba proporcional al acelerador y el rozamiento
sólo actuaba al soltar el pie. Consecuencia: **cualquier** acelerador mayor que
cero terminaba llevando el kart al tope, sólo cambiaba cuánto tardaba. Eso
volvía decorativos el levante de pie de la IA en las curvas y las tres
dificultades, que iban todas a fondo y se abrían igual; el rival "difícil"
llegaba a dar menos vueltas que el "fácil". Ahora el acelerador fija una
velocidad objetivo (`maxSpeed × throttle`) y por encima de ella el motor deja de
empujar.

### Otras tres decisiones

**La física va a paso fijo de 1/120 s**, con acumulador, separada del render. El
manejo se siente igual a 30 o a 144 FPS, y —lo que importa para el online— la
simulación es determinista y se puede reproducir para reconciliar estados. Los
poderes y sus colisiones avanzan en el mismo paso, por la misma razón.

**`KartPhysics` no sabe nada de Three.js más allá de los vectores.** No toca la
escena ni la cámara: `KartView` lee su estado y dibuja. Eso permite correr la
misma física en el servidor.

**El jugador y los rivales son el mismo objeto `Racer`.** Lo único que cambia es
de dónde sale el `InputState` de cada frame: del teclado o del `AiDriver`. Los
rivales no tienen velocidad ni agarre extra —sólo manejan distinto—, y en el
modo online un rival va a ser simplemente un `Racer` cuyo input llega por la
red.

## Herramientas de verificación

Además de la suite, hay dos scripts que sólo sirven para mirar el resultado, que
es la única forma de validar una cara:

```bash
SCRATCH=/tmp node scripts/head-shots.mjs   # cada cabeza de frente, 3/4, perfil y atrás
SCRATCH=/tmp node scripts/shot.mjs '' afiche 1440 900   # captura de una pantalla
```

Las cabezas se revisan a **cuatro ángulos** a propósito: de frente casi todo
parece bien, y los problemas —el casquete que se hunde, el pelo que se abre, la
nuca pelada— aparecen a tres cuartos y de perfil, que es justo desde donde se ve
al piloto mientras se corre.

## El modo en red

```bash
npm run test:net     # dos pestañas, una partida, sin internet
```

La prueba abre dos pestañas, las mete en la misma sala y verifica que **lo que
aprieta una mueve su kart en la pantalla de la otra**. Medirlo sobre el anfitrión
no es un detalle: él es quien simula, así que si ahí se movió es porque las
teclas viajaron de verdad. Mirando la pestaña del invitado no se probaría nada —
ahí el kart se mueve por su propia física, conectado o no.

Una cosa a tener presente: **la pestaña que queda en segundo plano deja de
simular**. El navegador le baja el `requestAnimationFrame` a uno por segundo. Para
un invitado se nota poco, pero si el anfitrión minimiza el juego, la carrera se
frena para todos.

## Tests

```bash
npm run build
node test/smoke.mjs
```

Abre el juego en Chromium y lo maneja por la API de override de inputs,
avanzando el reloj a mano en vez de esperar al `requestAnimationFrame`: el test
es determinista y corre en segundos. 115 verificaciones: manejo (aceleración,
velocidad punta, frenado, dirección, derrape, mini turbo, fuera de pista,
banquina, barrera, contramano), choques entre karts, rampas y cajas, los cuatro
poderes uno por uno —incluido que el misil siga el trazado y no corte camino—,
la parrilla de largada, que los rivales avancen y se mantengan en pista, que las
posiciones sean coherentes, que la dificultad se note, que una carrera se pueda
terminar, que las seis pistas se recorran enteras con su escenografía animada y
su minimapa, y los controles (cada esquema de teclado responde a sus teclas y no
a las otras, los botones táctiles mueven el kart, `Esc` abre las opciones y
pausa de verdad, y cambiar de teclado ahí se aplica en el acto). También la
presentación: que se llame Family Kart, que entren los seis escalonados con sus
renders decodificados, que al cerrarse quede el menú con la parrilla, que cada
tarjeta lleve la foto real y el vehículo, y que en pista el piloto tenga puesta
su foto y no el dibujo.

Varias verificaciones son visuales o de pantalla, porque los bugs de este
proyecto vinieron casi todos de ahí: una malla puede existir, estar bien
colocada y aun así ser invisible si sus caras quedaron al revés; el kart puede
estar dibujado medio metro por encima del piso; y la dirección puede estar
espejada aunque toda la matemática interna sea coherente consigo misma. El test
renderiza la misma vista con y sin la malla del asfalto y con y sin el kart,
mide la separación entre el punto más bajo del modelo y el terreno —sobre el
asfalto y sobre la banquina— y proyecta el kart con la cámara del jugador para
comprobar hacia qué lado del cuadro dobla. Deja capturas de cada pista y de cada
kart en `test/`.

## Próximos hitos

4. **Varios jugadores humanos.** Pantalla dividida en la misma máquina, o el
   modo online.
5. **Multijugador online.** Servidor autoritativo corriendo la misma
   `KartPhysics`, con predicción en el cliente y reconciliación. `LapTracker`
   ya expone `totalProgress`, que es la métrica de orden de carrera.
6. **Sonido.**
