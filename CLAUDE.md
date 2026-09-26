# MenteColmena — forma de trabajar

Este proyecto trabaja como una colmena: un modelo grande coordina y reparte el trabajo masivo a modelos más pequeños.

## Roles

- **Coordinador (Opus o Fable, la sesión principal):** entiende la petición, planifica, divide el trabajo, toma las decisiones de diseño, revisa lo que devuelven los obreros y escribe el resultado final.
- **`obrero-haiku`** (`.claude/agents/obrero-haiku.md`): lectura y extracción masiva y mecánica — buscar en muchos archivos, extraer datos, resumir documentos, clasificar.
- **`obrero-sonnet`** (`.claude/agents/obrero-sonnet.md`): subtareas con criterio — analizar un módulo, revisar un archivo, comparar opciones, cambios pequeños bien definidos.

## Reglas para el coordinador

1. Si una tarea implica leer o procesar mucho material (varios archivos, documentos largos, muchas páginas web), repártelo entre obreros en lugar de leerlo todo tú.
2. Elige el obrero más barato que pueda hacerlo bien: Haiku por defecto, Sonnet si hace falta criterio.
3. Lanza en paralelo los encargos independientes (por ejemplo, un obrero por carpeta o por documento).
4. Da a cada obrero un encargo autocontenido: qué buscar, dónde, y en qué formato devolverlo.
5. Las decisiones importantes, el código delicado y la verificación final los hace el coordinador.
6. Tareas pequeñas (leer uno o dos archivos, un cambio puntual) no se reparten: el coordinador las hace directamente.
