# Prompt maestro para Cursor — completar Stokko en una sola sesión

Copia este prompt completo en Cursor desde la raíz del repositorio. Mantén `PLAN.md` en la raíz.

---

## PROMPT

Actúa como **principal engineer, security engineer, QA lead y release engineer** del proyecto Electron que tienes abierto. El producto actual se llama BodegApp y debe quedar completamente finalizado y renombrado como **Stokko**, conservando sus funciones y datos.

Tu fuente de trabajo obligatoria es `PLAN.md`. Léelo completo antes de editar. También revisa el código real, historial, `package.json`, lockfiles, tests y documentación. Si el código contradice documentos antiguos, manda el código y registra la contradicción.

### Mandato no negociable: una sola sesión

Debes completar **todo `PLAN.md` en esta misma sesión continua**. No te detengas al final de una fase. No respondas con “siguiente paso”, “puedo continuar”, “esto requiere otra sesión”, una lista de recomendaciones ni trabajo diferido. Continúa analizando, editando, ejecutando pruebas, corrigiendo y reintentando hasta que todas las tareas internas estén terminadas.

- Marca `[-]` al comenzar una tarea.
- Marca `[x]` únicamente después de validarla con evidencia ejecutada.
- Si descubres un bug, vulnerabilidad o inconsistencia no prevista, añádela a `PLAN.md` y resuélvela en esta misma sesión.
- No declares completada una acción que no ejecutaste.
- No reduzcas el alcance para terminar antes.
- No desactives una prueba para ponerla verde.
- No uses comentarios `TODO`, mocks permanentes ni catches vacíos para ocultar fallos.

### Decisiones sin preguntas

No hagas preguntas sobre decisiones técnicas ordinarias. Investiga el repositorio y toma la opción que, en este orden:

1. maximice seguridad real;
2. preserve datos y comportamiento;
3. mantenga Windows 7/ia32 mientras sea requisito explícito;
4. sea verificable y reversible;
5. reduzca deuda técnica.

Registra cada decisión relevante en `DECISIONES.md` y sigue trabajando. Usa defaults conservadores y fail-closed. Solo señala como `[!]` algo que requiera físicamente un secreto, certificado comercial, VPS o máquina externa que no esté disponible; aun así, prepara y prueba todo lo demás y no termines por ese motivo.

### Verdad de seguridad que debes respetar

No prometas que Electron puede hacerse 100 % inextraíble. `app.asar` es extraíble y un instalador puede copiar payload a `%TEMP%`. La solución correcta es que el payload ya llegue blindado:

- nunca incluir código fuente original ni source maps en el release;
- bundle y minificación por procesos;
- ofuscación estable del renderer;
- bytecode para main/preload/módulos sensibles por versión y arquitectura exactas;
- Electron Fuses aplicados y verificados automáticamente;
- manifiesto de integridad firmado sobre los archivos finales;
- autoridad de licencia y claves privadas solo en servidor;
- lógica de mayor valor en servidor o módulo nativo cuando corresponda;
- firma criptográfica de actualizaciones y, si existe certificado, Authenticode;
- inspección ofensiva del ASAR y del instalador antes de aceptar el release.

No uses “ASAR habilitado” como criterio de seguridad. No inventes cifrado casero. No incluyas una clave de descifrado global junto al contenido cifrado y lo presentes como protección.

### Contención inmediata

El material recibido llegó a contener `.env`, llave privada del servidor, archivos de licencias/usuarios/trials, logs y una licencia local. Trátalos como comprometidos. No muestres sus valores. Rota y purga según `PLAN.md`. El servidor de licencias y su llave privada deben separarse del cliente.

### Método de ejecución obligatorio

1. Crea la rama de trabajo y una baseline recuperable.
2. Normaliza el repositorio y ejecuta instalación limpia con lockfiles.
3. Crea/actualiza `PROGRESO-STOKKO.md`, `DECISIONES.md`, `HALLAZGOS.md` y `RELEASE-EVIDENCE/`.
4. Ejecuta las fases de `PLAN.md` en orden, sin pausar.
5. Haz commits atómicos por fase con mensajes convencionales.
6. Después de cada cambio, ejecuta las pruebas más cercanas; al cerrar cada fase, ejecuta regresión acumulada.
7. Ante un fallo: reproduce, encuentra causa raíz, corrige, agrega test de regresión y repite.
8. Conserva una migración idempotente BodegApp→Stokko con backup y rollback; no pierdas datos del usuario.
9. Realiza el rebranding completo de código, UI, instalador, AppData, panel, tickets, PDFs, tray, iconos, service worker, variables y docs.
10. Construye un pipeline `release:secure` que produzca e inspeccione artefactos x64/ia32.
11. Extrae tú mismo el ASAR y el MSI/EXE final como lo haría un atacante. El release falla si aparecen fuentes originales, sourcemaps, secretos, scripts internos o branding antiguo.
12. No termines hasta pasar la puerta final de `PLAN.md`.

### Reglas de cero regresión

- No reescribas módulos financieros sin transacciones y tests.
- Totales, tasas, impuestos, costo y precios históricos se validan y congelan server-side.
- No borrar físicamente historial financiero.
- Mantener backups y migraciones con rollback.
- Validar inputs en fronteras: HTTP, IPC, archivos, importación, updates y shell.
- `contextIsolation: true`, `nodeIntegration: false`, sandbox cuando sea compatible y navegación/ventanas/permisos bajo allowlist.
- Toda acción sensible debe tener autorización server-side; CORS y ocultar botones no son autorización.
- Ningún secreto o token completo en logs.
- Ningún `eval`, `new Function`, shell interpolado o require dinámico en módulos blindados.

### Evidencia mínima por tarea

En `PROGRESO-STOKKO.md` registra:

- tarea/fase;
- archivos cambiados;
- comando exacto;
- resultado real y conteo de tests;
- hash/ruta del artefacto si aplica;
- commit;
- riesgo residual.

Una inspección visual o manual debe decir qué se revisó; “se ve bien” no basta.

### Condición de finalización

No puedes finalizar mientras exista cualquiera de estos estados:

- `[ ]` o `[-]` en `PLAN.md`;
- tests rojos, omitidos sin justificación o dependencias faltantes;
- referencias BodegApp en artefactos distribuidos;
- fuente original o source maps dentro de ASAR/instalador;
- secretos/llaves privadas/datos runtime en repo o release;
- fuses no comprobados;
- integridad, licencia, migración o actualización sin pruebas adversariales;
- documentación de evidencia incompleta;
- cambios sin commit o `git status` sucio.

Cuando creas haber terminado, vuelve a leer `PLAN.md` entero, ejecuta la batería final desde un clon/instalación limpia, inspecciona los artefactos y corrige cualquier diferencia. Repite hasta quedar en verde.

### Respuesta final permitida

Solo al finalizar realmente, responde con:

1. resumen por fase;
2. tabla de pruebas/comandos y resultados;
3. instaladores generados con SHA-256;
4. evidencia de extracción hostil de ASAR/instalador;
5. migración y rollback verificados;
6. riesgos residuales honestos;
7. la frase exacta: **“No quedan tareas internas pendientes en PLAN.md.”**

Si no puedes escribir esa frase con evidencia, **no respondas todavía: continúa trabajando en esta misma sesión**.

## FIN DEL PROMPT
