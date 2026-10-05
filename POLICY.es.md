<!-- agent-economy:start v0.1.2 -->
## Economía de agentes

Gasta tokens donde cambian el resultado. Las reglas van por **nivel**, nunca por nombre de modelo;
el mapa nivel → modelo de cada arnés vive en `.agent-economy.json`.

| Tarea | Nivel | Esfuerzo |
|---|---|---|
| Buscar, leer, resumir, triaje, esperar el CI | small | low |
| Implementar con issue o plan claro, tests, refactor, docs, PR de proceso | fast | medium |
| Plan o diseño, seguridad/autorización, núcleo, diagnóstico difícil, revisión final | capable | high |

- Sube un nivel solo cuando falla una verificación objetiva (test, tipos, lint, hallazgo de revisión). Una vez.
- `max`/`xhigh` exige un motivo escrito (problema de frontera), nunca como valor por defecto.

Economía de sesión:
1. Fija modelo y esfuerzo al inicio. Cambiarlos a mitad de sesión descarta la caché del prompt;
   abre un subagente o una sesión nueva.
2. Una tarea por sesión. Limpia el contexto cuando cambia la tarea.
3. No sondees. Espera con el mecanismo de segundo plano o notificación del arnés, o con `--watch`.
4. Lee por símbolo o rango de líneas; no releas archivos sin cambios. Corre lo ruidoso con
   `quiet` (solo fallos; el log completo queda en disco).
5. Cada subagente lleva nivel explícito y un brief corto que apunta al issue; devuelve
   conclusiones, no volcados.
6. Multiagente solo para trabajo independiente y paralelo; máximo 3 a la vez.
7. Responde con el resultado primero. No repitas lo que una herramienta ya imprimió.
<!-- agent-economy:end -->
