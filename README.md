# Brainwriting en vivo · Momento 2 — Ideación

Herramienta web multi-dispositivo para correr la actividad de **Brainwriting**: cada
participante trabaja una "hoja" desde su celular o notebook, y las hojas **rotan a la
derecha** en cada ronda. El facilitador controla el timer, avanza las rondas, ve todo en
vivo y exporta los resultados.

- **Facilitador**: crea la sala, define la necesidad, arranca/pausa el timer, pasa de ronda y exporta.
- **Participantes**: entran con un código de 4 letras (o un link/QR), escriben su aporte por ronda.
- **Rotación automática**: en la ronda 2 cada uno recibe la hoja del vecino de la izquierda; en la 3, otra más. Así cada hoja acumula 3 capas de aportes de 3 personas distintas.
- **Export**: al terminar, el facilitador descarga todo en `.md`, `.csv` o `.json`.

Por defecto trae las 3 rondas de la consigna (generar 4 min, construir 4 min, construir 4 min),
editables antes de arrancar. Para trabajar una segunda necesidad, al terminar usá
"Reiniciar (nueva necesidad)": se limpian las hojas y quedan los mismos participantes.

---

## Probarlo en tu compu (1 minuto)

Necesitás Node 18+.

```bash
npm install
npm start
```

Abrí http://localhost:3000. Para probar la rotación, abrí la misma URL en varias pestañas
(una como facilitador, las otras como participantes).

---

## Deploy gratis (para el taller real)

La app necesita estar en internet para que todos entren desde sus dispositivos. Cualquiera
de estas dos opciones tiene plan gratuito y no requiere tarjeta para empezar.

### Opción A — Render

1. Subí esta carpeta a un repo de GitHub (o usá "Deploy from a public Git repo").
2. En https://render.com → **New → Web Service** → conectá el repo.
3. Configuración:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Deploy. En un par de minutos tenés una URL tipo `https://tu-app.onrender.com`.

### Opción B — Railway

1. https://railway.app → **New Project → Deploy from GitHub repo** (o **Empty Project** y subí los archivos).
2. Railway detecta Node y usa `npm start` solo. Si te lo pide:
   - **Start Command**: `npm start`
3. En **Settings → Networking → Generate Domain** para obtener la URL pública.

En ambos casos el puerto lo maneja la plataforma sola (la app lee `process.env.PORT`).

---

## Cómo se usa el día del taller

1. Entrá a la URL y tocá **Crear sala** (opcionalmente escribí ya la necesidad).
2. Compartí el **código de 4 letras**, el **link** o el **QR** con los participantes.
3. Cuando estén todos (2 o más), tocá **Arrancar taller**. Arranca la Ronda 1 con el timer.
4. Al terminar cada ronda, tocá **Siguiente ronda** → las hojas rotan solas.
5. Después de la última ronda, **Terminar** y **Descargar** los resultados.

---

## Notas técnicas

- Node + Express + Socket.IO. El estado vive **en memoria** (una sola instancia).
  Para un taller es ideal; pero si el servidor se reinicia (los planes free "duermen" por
  inactividad), se pierde la sesión en curso. Recomendación: en el free tier de Render,
  entrá a la URL unos minutos antes para "despertar" el servicio, y no lo dejes inactivo
  durante el taller.
- Sin base de datos ni cuentas: los participantes solo ponen su nombre.
- Reconexión automática: si a alguien se le corta el wifi, al volver retoma su hoja.
- El QR se genera con un servicio externo (api.qrserver.com); si esa red no está
  disponible, siempre queda el link y el código como alternativa.

## Estructura

```
server.js            Servidor + lógica de sesiones, rondas, rotación y timer
public/index.html    Cliente (facilitador + participante), todo en un archivo
package.json         Dependencias y scripts
```
