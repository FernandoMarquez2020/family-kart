#!/usr/bin/env python3
"""
Detecta los 68 puntos de la cara en cada foto de `fotos/` y los guarda en
`scripts/landmarks.json`.

Por qué esto en lugar de las coordenadas a mano que había antes: leer las
pupilas sobre una grilla parece exacto y no lo es. En las fotos donde la cara
está girada o inclinada el ojo más lejano se lee corrido, y el error se
multiplica por la escala: dos o tres píxeles de diferencia entre pupilas mueven
la cara entera media frente cuando se estira a 512. Con los 68 puntos no sólo
salen las pupilas bien, sale además el CONTORNO real de cada cara, que es lo que
permite recortar sin que entre fondo en las caras de tres cuartos.

El modelo viene del paquete `face_recognition_models` de PyPI (el .dat de dlib
no se puede bajar directo desde acá). Se extrae una sola vez al scratchpad.

Uso: python3 scripts/landmarks.py
"""

import json
import os
import sys

import dlib
import numpy as np
from PIL import Image

MODEL = os.environ.get(
    "DLIB_LANDMARKS",
    "/tmp/claude-0/-home-claude/b748ef19-bd0e-59fc-945c-49df639273e4/scratchpad/models/shape_predictor_68_face_landmarks.dat",
)

CHARACTERS = ["futbol", "gaming", "bloques", "rosa", "puerto", "miami"]

# Índices del esquema de 68 puntos.
JAW = list(range(0, 17))        # contorno, de sien a sien pasando por el mentón
BROW_R = list(range(17, 22))    # ceja derecha de la imagen (izquierda del sujeto)
BROW_L = list(range(22, 27))
NOSE_BRIDGE = list(range(27, 31))
NOSE_BASE = list(range(31, 36))
EYE_R = list(range(36, 42))
EYE_L = list(range(42, 48))
MOUTH = list(range(48, 68))


def detect(path: str, detector, predictor):
    """Devuelve los 68 puntos de la cara más grande de la foto."""
    img = np.array(Image.open(path).convert("RGB"))

    faces = detector(img, 1)
    if not faces:
        # Segunda pasada sobre la imagen reducida: en las fotos grandes la cara
        # a veces excede la ventana del detector.
        small = np.array(Image.open(path).convert("RGB").resize(
            (img.shape[1] // 2, img.shape[0] // 2)))
        found = detector(small, 1)
        if not found:
            return None
        faces = [dlib.rectangle(f.left() * 2, f.top() * 2, f.right() * 2, f.bottom() * 2)
                 for f in found]

    face = max(faces, key=lambda f: f.width() * f.height())
    shape = predictor(img, face)
    return [(shape.part(i).x, shape.part(i).y) for i in range(68)]


def main() -> None:
    if not os.path.exists(MODEL):
        sys.exit(f"falta el modelo de landmarks en {MODEL}")

    detector = dlib.get_frontal_face_detector()
    predictor = dlib.shape_predictor(MODEL)

    out = {}
    for cid in CHARACTERS:
        path = f"fotos/{cid}.jpg"
        pts = detect(path, detector, predictor)
        if pts is None:
            print(f"{cid}: SIN DETECCIÓN")
            continue

        arr = np.array(pts, dtype=float)
        left_eye = arr[EYE_R].mean(axis=0)    # ojo a la izquierda EN LA IMAGEN
        right_eye = arr[EYE_L].mean(axis=0)
        out[cid] = {
            "points": [[int(x), int(y)] for x, y in pts],
            "leftEye": [round(float(left_eye[0]), 1), round(float(left_eye[1]), 1)],
            "rightEye": [round(float(right_eye[0]), 1), round(float(right_eye[1]), 1)],
            "size": Image.open(path).size,
        }
        span = float(np.hypot(*(right_eye - left_eye)))
        print(f"{cid}: ojos {left_eye.round(0)} {right_eye.round(0)}  separación {span:.0f}px")

    with open("scripts/landmarks.json", "w") as fh:
        json.dump(out, fh, indent=1)
    print(f"\n{len(out)}/6 caras detectadas → scripts/landmarks.json")


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(__file__), ".."))
    main()
