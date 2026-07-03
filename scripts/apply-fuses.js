#!/usr/bin/env node
// scripts/apply-fuses.js
// Fase 13.1 — Aplica Electron Fuses al binario EMPAQUETADO (paso de RELEASE, no de dev).
// Endurece el runtime: no permite ejecutar como Node genérico ni --inspect, y solo carga
// la app desde el asar. Se corre DESPUÉS de empaquetar, en la máquina de release.
//
// Requisitos (instalar solo en release):  npm i -D @electron/fuses
// Uso:  node scripts/apply-fuses.js <ruta-al-ejecutable-empaquetado>
//
// NO se ejecuta en desarrollo (no está enganchado a ningún script npm por defecto).
const path = require('path');

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Uso: node scripts/apply-fuses.js <ruta-al-.exe-empaquetado>');
    process.exit(1);
  }

  let fusesMod;
  try {
    fusesMod = require('@electron/fuses');
  } catch (_) {
    console.error('[ERROR] Falta @electron/fuses. Instálalo en la máquina de release: npm i -D @electron/fuses');
    process.exit(1);
  }

  const { flipFuses, FuseVersion, FuseV1Options } = fusesMod;
  console.log('[FUSES] Aplicando fuses a:', path.resolve(target));

  await flipFuses(target, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // EnableEmbeddedAsarIntegrityValidation: puede no estar soportado en Electron 22/Windows.
    // La integridad portable la garantiza el self-check propio (Fase 11.8).
  });

  console.log('[FUSES] OK: RunAsNode/NodeOptions/NodeCliInspect desactivados; OnlyLoadAppFromAsar activado.');
}

main().catch((err) => {
  console.error('[FUSES] Error:', err.message);
  process.exit(1);
});
