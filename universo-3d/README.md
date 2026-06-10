# 🌌 Universo 3D

Sistema estelar procedural, animado y totalmente personalizable, construido con **Three.js**.

## ✨ Qué incluye

- **Sol** con resplandor (bloom) y luz puntual real que ilumina los planetas.
- **6 planetas** con texturas procedurales (gigantes gaseosos con franjas, mundos rocosos), inclinación orbital variable, **anillos** y **lunas** en órbita.
- **Cinturón de asteroides** con 1.400 rocas (InstancedMesh, muy eficiente).
- **Campo de 12.000 estrellas** de colores en una esfera 3D.
- **Nebulosas** de color difuso al fondo.
- **Estrellas fugaces** aleatorias.
- **Post-procesado bloom** para que todo brille de forma realista.
- **Estelas orbitales** que cada planeta deja a su paso, desvaneciéndose.
- **Vía Láctea** de fondo (domo procedural con banda galáctica y polvo).
- **Agujero negro** con horizonte de sucesos, **disco de acreción** (gradiente de temperatura + Doppler beaming) y **lente gravitacional** real en post-proceso (la luz de fondo se curva, formando un anillo de Einstein).

## 🔬 Física

- **Órbitas Keplerianas**: la velocidad angular sigue ω ∝ d^(-3/2) (3ª ley de Kepler), igual que en el Sistema Solar real: los planetas interiores van más rápido.
- **Masas** ∝ volumen (r³). El disco del agujero negro brilla más en el lado que se acerca (efecto Doppler relativista).
- **Lente gravitacional**: deflexión de la luz aproximando el ángulo de Einstein α ∝ 1/distancia.

## 🎮 Controles

- **Arrastrar** → orbitar la cámara.
- **Rueda del ratón** → zoom (puedes acercarte mucho a cualquier objeto).
- **Clic en cualquier cuerpo** (planeta, luna, asteroide, Sol o agujero negro) → la cámara **vuela hasta él, lo sigue** y muestra su ficha física.
- **Esc** → vista libre (deseleccionar).
- **Panel ⚙ (arriba a la derecha)** → personaliza:
  - Velocidad de las órbitas
  - Nº de estrellas
  - Color y tamaño del sol
  - Intensidad y radio del brillo (bloom)
  - Mostrar/ocultar órbitas y cinturón
  - Auto-rotación de cámara
  - 🎨 Recolorar planetas al azar
  - 🔭 / 🛰 Vistas predefinidas

## ▶️ Cómo ejecutarlo

Necesita un servidor local (los módulos ES no se cargan desde `file://`). Desde esta carpeta:

```powershell
# Opción A — Python
python -m http.server 8080

# Opción B — Node
npx serve .
```

Luego abre <http://localhost:8080> en el navegador.

## 🛠️ Personalización por código

Edita el array `PLANET_PRESETS` en `app.js` para añadir/quitar planetas. Cada uno acepta:
`name, base, accent, size, dist, speed, moons, ring, bands`.

Los valores por defecto del panel están en el objeto `config` al inicio de `app.js`.
