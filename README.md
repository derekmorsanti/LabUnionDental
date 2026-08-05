# LabUnionDental

## Cambios realizados — Agenda de Cony (Yesos) dividida en AM / PM

Se modificó únicamente la agenda de **Cony — Yesos** para que muestre **dos
tablas independientes, una junto a la otra**: **AM** y **PM**. El resto de
agendas (Eliu, Abner, Dina, Astryd) siguen funcionando exactamente igual que
antes, sin ningún cambio visual ni de comportamiento.

### Archivos modificados

- **`js/agenda-configs.js`** — se agregó la bandera `splitAmPm: true` a la
  configuración de Cony. Es la única fuente de verdad de qué agenda se
  divide en tandas.

- **`js/agenda.js`** — reescrito para renderizar por **"instancias"** en
  vez de una sola tabla fija:
  - Si la agenda no tiene `splitAmPm`, se renderiza **una sola instancia**
    (`key = ''`), con los mismos ids de siempre (`agenda-table`,
    `agenda-thead`, `btn-save-agenda`, etc.) — cero cambios de
    comportamiento para Eliu, Abner, Dina y Astryd.
  - Si la agenda tiene `splitAmPm` (Cony), se renderizan **dos
    instancias**, `am` y `pm`, cada una con:
    - su propio estado en memoria (filas, columnas extra, metas),
    - sus propios elementos del DOM (ids con sufijo `-am` / `-pm`,
      generados dinámicamente),
    - su propio botón de Guardar, Descargar, +Fila, +Columna, −Columna,
      y su propio indicador de "Guardando… / Guardado",
    - su propio debounce de autoguardado (1.5 s), totalmente
      independiente entre AM y PM: escribir en una tabla nunca dispara
      ni interfiere con el guardado de la otra.
  - El diseño de cada tabla (clases CSS, estilos, comportamiento de
    clic/doble clic, cálculo de totales/diferencia) es **exactamente el
    mismo** que la tabla original — solo se duplicó la estructura, no la
    lógica.

- **`index.html`** — la sección `AGENDA (tabla)` ya no tiene una tabla fija
  en el HTML; ahora tiene un contenedor vacío (`#agenda-container`) que
  `agenda.js` llena dinámicamente con uno o dos paneles según la agenda.

- **`css/styles.css`** — se agregaron dos clases nuevas, sin tocar ninguna
  regla existente:
  - `.agenda-split-grid`: coloca los dos paneles (AM/PM) uno junto al
    otro en escritorio, y los apila en pantallas angostas
    (`max-width: 980px`).
  - `.agenda-panel-label`: la pequeña etiqueta "AM" / "PM" junto al
    título de cada tabla.

- **`js/historial.js`** — pequeño ajuste para que, en el historial de
  Cony, cada tarjeta muestre si corresponde a la tanda **AM** o **PM**
  del día (ya que ahora un mismo día puede tener dos agendas guardadas).

- Todos los módulos (`js/*.js`) e `index.html` — se subió el parámetro de
  caché de las importaciones/scripts de `?v9` a `?v10`, para que los
  navegadores que ya habían cargado la app antes descarguen los archivos
  actualizados en vez de servir versiones antiguas desde caché.

### Persistencia en Firestore (sin cambios de estructura)

No se modificó `js/data-store.js` ni la estructura de colecciones/documentos
existente. Se reutiliza exactamente el mismo esquema de siempre:

- **Agenda del día:** `users/{uid}/agendas/{agendaId}_{dateKey}`
  Para Cony, la `dateKey` ahora lleva sufijo `-AM` / `-PM`
  (ej. `2026-08-05-AM` y `2026-08-05-PM`), por lo que cada tanda queda
  guardada en su **propio documento**, sin pisarse entre sí. El campo
  `agendaId` dentro del documento sigue siendo `'cony'` en ambos casos, así
  que Historial sigue encontrando y listando las dos tandas de cada día sin
  ningún cambio adicional en `data-store.js`.
- **Columnas dinámicas (+/-):** `users/{uid}/agendaConfigs/{agendaId}`
  Para Cony, AM y PM usan ids de almacenamiento independientes
  (`cony-am` y `cony-pm`), por lo que agregar o quitar una columna en una
  tabla no afecta a la otra.

Como no se cambió ningún nombre de colección ni el formato de los
documentos existentes de las demás agendas, **ningún dato guardado
previamente se pierde ni requiere migración**: las agendas de Eliu, Abner,
Dina y Astryd siguen leyéndose y guardándose exactamente igual que antes.

### Compatibilidad hacia atrás

Si Cony ya tenía agendas guardadas con el esquema anterior (sin sufijo
`-AM`/`-PM`, de antes de este cambio), esos documentos simplemente quedan
como registros antiguos visibles en Historial (con su fecha, sin la
etiqueta AM/PM); no se borran ni se sobrescriben. Las nuevas agendas de
Cony, a partir de esta actualización, siempre se guardan ya divididas en
AM y PM.
