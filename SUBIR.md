# Cómo subirlo a GitHub Pages

El repositorio ya está inicializado y con el primer commit hecho. Falta crearlo
en GitHub y empujarlo.

## 1. Crear el repositorio vacío

En <https://github.com/new>:

- Nombre: `family-kart`
- Público
- **Sin** README, sin `.gitignore` y sin licencia — tiene que quedar vacío, o
  choca con el commit que ya está hecho acá.

## 2. Empujarlo

Desde la carpeta del proyecto:

```bash
git remote add origin https://github.com/FernandoMarquez2020/family-kart.git
git push -u origin main
```

## 3. Activar Pages

En el repositorio: **Settings → Pages → Source: GitHub Actions**.

Con eso, el workflow que ya está en `.github/workflows/deploy.yml` compila y
publica en cada push a `main`. La primera vez tarda un par de minutos.

La dirección queda:

```
https://fernandomarquez2020.github.io/family-kart/
```

Ese es el link que compartís con la familia, y el mismo que sirve para las salas
del modo en red.

## Lo que NO se sube

`fotos/` está en el `.gitignore`. El juego compila igual porque usa las texturas
ya recortadas, que están generadas y versionadas. Si alguna vez clonás el repo en
otra máquina y querés regenerar las caras, vas a tener que copiar `fotos/` a
mano.

Comprobado: compilando desde una copia exacta de lo que GitHub recibe —sin
`fotos/`— el build sale bien.

## Lo que no hace falta

Ni Firebase, ni un servidor, ni base de datos. El juego es estático y el modo en
red es punto a punto. El detalle completo está en el README, en *Publicarlo en la
web*.
