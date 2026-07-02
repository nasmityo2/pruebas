/**
 * Utilities for direct printing from any module (Reprint)
 */

/**
 * Codifica una cadena a bytes (solo caracteres de un byte para evitar errores de UTF-8 en impresoras)
 */
function encodeToSingleByte(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Mapa básico para caracteres comunes en español
    if (code < 128) bytes[i] = code;
    else if (code === 241) bytes[i] = 164; // ñ
    else if (code === 209) bytes[i] = 165; // Ñ
    else if (code === 225) bytes[i] = 160; // á
    else if (code === 233) bytes[i] = 130; // é
    else if (code === 237) bytes[i] = 161; // í
    else if (code === 243) bytes[i] = 162; // ó
    else if (code === 250) bytes[i] = 163; // ú
    else bytes[i] = 32; // Espacio para desconocidos
  }
  return bytes;
}

/**
 * Convierte una imagen a ESC/POS Raster Bit Image (GS v 0) con ancho fijo.
 */
async function logoToEscPos(url, fixedWidth = 384) {
  return new Promise((resolve) => {
    const img = new Image();
    if (!url.startsWith('data:')) {
      img.crossOrigin = 'Anonymous';
    }
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      
      const w = Math.floor(fixedWidth / 8) * 8;
      const widthBytes = w / 8;
      const scale = w / img.width;
      const h = Math.floor(img.height * scale);
      
      canvas.width = w;
      canvas.height = h;
      
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const bitMap = new Uint8Array(widthBytes * h);
      
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const r = data[idx];
          const g = data[idx+1];
          const b = data[idx+2];
          const alpha = data[idx+3];
          
          if (alpha < 10) continue; 
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luminance < 230) { 
            const byteIdx = y * widthBytes + (x >> 3);
            const bit = 0x80 >> (x % 8);
            bitMap[byteIdx] |= bit;
          }
        }
      }
      
      const xL = widthBytes & 0xFF;
      const xH = (widthBytes >> 8) & 0xFF;
      const yL = h & 0xFF;
      const yH = (h >> 8) & 0xFF;

      const centerCmd = [0x1B, 0x61, 0x01];
      const header = [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH];
      const reset = [0x1B, 0x61, 0x00]; 
      
      const result = new Uint8Array(centerCmd.length + header.length + bitMap.length + reset.length);
      let offset = 0;
      [centerCmd, header, bitMap, reset].forEach(chunk => {
        result.set(chunk, offset);
        offset += chunk.length;
      });
      
      resolve(result);
    };
    img.onerror = (err) => {
      console.error('Error cargando logo para ESC/POS:', err);
      resolve(null);
    };
    img.src = url;
  });
}

function trunc(text, width) {
  text = (text || '').toString();
  if (text.length > width) return text.slice(0, width);
  return text;
}

function formatLine(left, right, width) {
  left = (left || '').toString();
  right = (right || '').toString();
  const totalLen = left.length + right.length;
  if (totalLen >= width) {
    left = left.slice(0, Math.max(0, width - right.length - 1));
    return (left + ' ' + right).slice(0, width);
  }
  const spaces = width - totalLen;
  return left + ' '.repeat(spaces) + right;
}

function formatPriceStr(num) {
  return Number(num || 0).toFixed(2).replace('.', ',');
}

// --- FUNCIÓN PARA GENERAR EL TEXTO DEL TICKET (REUTILIZABLE) ---
function generateTicketText(sale, products, cliente, payments, settings, width) {
    const lineStr = '-'.repeat(width);
    const bcvMoment = Number(sale.total_ves / (sale.total_usd_bcv || 1)) || 1;
    const saleDate = new Date(sale.creado_en || sale.created_at);
    const dateStr = saleDate.toLocaleDateString('es-VE');
    const timeStr = saleDate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    let t = "";
    // Header
    const headerLines = (settings.printHeader || "").split('\n').filter(l => l.trim());
    headerLines.forEach(l => {
        t += ' '.repeat(Math.max(0, Math.floor((width - l.trim().length) / 2))) + l.trim().toUpperCase() + '\n';
    });

    // Biz info
    if (settings.businessRIF) t += ' '.repeat(Math.max(0, Math.floor((width - settings.businessRIF.length - 5) / 2))) + `RIF: ${settings.businessRIF.toUpperCase()}\n`;
    if (settings.businessAddress) {
        settings.businessAddress.split('\n').forEach(l => {
            t += ' '.repeat(Math.max(0, Math.floor((width - l.trim().length) / 2))) + l.trim().toUpperCase() + '\n';
        });
    }
    if (settings.businessPhone) t += ' '.repeat(Math.max(0, Math.floor((width - settings.businessPhone.length - 5) / 2))) + `TEL: ${settings.businessPhone}\n`;
    t += '\n';

    // Cliente
    const rif = cliente ? (cliente.cedula || 'V-000000000') : 'V-000000000';
    const name = cliente ? (cliente.nombre || 'CONSUMIDOR FINAL') : 'CONSUMIDOR FINAL';
    const dir = cliente ? (cliente.direccion || 'N/A') : 'N/A';
    const tel = cliente ? (cliente.telefono || 'N/A') : 'N/A';

    t += `RIF/C.I.: ${rif}\n`;

    // RAZON SOCIAL Multilínea
    const labelRS = "RAZON SOCIAL: ";
    let currentRS = name.toUpperCase();
    if (labelRS.length + currentRS.length > width) {
        t += labelRS + '\n';
        const wordsRS = currentRS.split(' ');
        let lineRS = '';
        wordsRS.forEach(w => {
            if ((lineRS + w).length < width) {
                lineRS += (lineRS ? ' ' : '') + w;
            } else {
                if (lineRS) t += lineRS + '\n';
                lineRS = w;
            }
        });
        if (lineRS) t += lineRS + '\n';
    } else {
        t += labelRS + currentRS + '\n';
    }

    // DIRECCION Multilínea
    const labelDir = "DIRECCION: ";
    let currentDir = dir.toUpperCase();
    if (labelDir.length + currentDir.length > width) {
        t += labelDir + '\n';
        const wordsDir = currentDir.split(' ');
        let lineDir = '';
        wordsDir.forEach(w => {
            if ((lineDir + w).length < width) {
                lineDir += (lineDir ? ' ' : '') + w;
            } else {
                if (lineDir) t += lineDir + '\n';
                lineDir = w;
            }
        });
        if (lineDir) t += lineDir + '\n';
    } else {
        t += labelDir + currentDir + '\n';
    }

    t += `TELEFONO: ${tel}\n`;
    t += `REF. INTERNA: ${String(sale.id).padStart(10, '0')}\n`;
    t += `VENDEDOR: 01\n`;
    t += ' '.repeat(Math.max(0, Math.floor((width - 6) / 2))) + 'RECIBO\n\n';

    t += formatLine('RECIBO:', String(sale.id).padStart(8, '0'), width) + '\n';
    t += formatLine(`FECHA: ${dateStr}`, `HORA: ${timeStr}`, width) + '\n';
    t += lineStr + '\n';

    // Productos
    products.forEach(p => {
        const isExempt = p.exento_iva === 1;
        const indicator = isExempt ? '(E)' : '(G)';
        const pName = (p.producto_nombre || 'Producto').toUpperCase() + ` ${indicator}`;
        
        // Multi-line name support
        const words = pName.split(' ');
        let currentLine = '';
        words.forEach(word => {
            if ((currentLine + word).length < width) {
                currentLine += (currentLine ? ' ' : '') + word;
            } else {
                if (currentLine) t += currentLine + '\n';
                currentLine = word;
            }
        });
        if (currentLine) t += currentLine + '\n';

        const qty = Number(p.cantidad || 0);
        const priceVes = Number(p.precio_unitario_ves || 0);
        const totalItemVes = qty * priceVes;
        const totalItemUsd = totalItemVes / bcvMoment;
        
        const qtyStr = formatPriceStr(qty);
        const priceStr = formatPriceStr(priceVes);
        const rightSide = `Bs ${formatPriceStr(totalItemVes)} ($ ${totalItemUsd.toFixed(2)})`;
        const leftSide = `${qtyStr} x ${priceStr}`;

        t += formatLine(leftSide, rightSide, width) + '\n';
    });


    t += lineStr + '\n';
    t += formatLine('SUBTTL', `Bs ${formatPriceStr(sale.total_ves)}`, width) + '\n';
    t += formatLine('SUBTTL ($)', `$ ${formatPriceStr(sale.total_usd_bcv)}`, width) + '\n';
    t += lineStr + '\n';

    // Impuesto
    const tax = sale.impuesto_total || 0;
    if (tax > 0) {
        const base = sale.total_ves - tax;
        t += formatLine('BI G16,00%', `Bs ${formatPriceStr(base)}`, width) + '\n';
        t += formatLine('IVA G16,00%', `Bs ${formatPriceStr(tax)}`, width) + '\n';
        t += lineStr + '\n';
    }

    // Pagos
    payments.forEach(pay => {
        let m = pay.metodo === 'VES_EFECTIVO' ? 'EFECTIVO' :
            pay.metodo === 'USD_EFECTIVO' ? 'EFE DIVISA' : pay.metodo;
        t += formatLine(m, `Bs ${formatPriceStr(pay.monto_en_ves)}`, width) + '\n';
    });

    t += lineStr + '\n';
    t += formatLine('TOTAL', `Bs ${formatPriceStr(sale.total_ves)}`, width) + '\n';
    t += formatLine('TOTAL ($)', `$ ${formatPriceStr(sale.total_usd_bcv)}`, width) + '\n';

    if (sale.monto_pendiente_usd > 0) {
        t += lineStr + '\n';
        const pendVes = sale.monto_pendiente_usd * bcvMoment;
        t += formatLine('PENDIENTE Bs:', `Bs ${formatPriceStr(pendVes)}`, width) + '\n';
        t += formatLine('PENDIENTE $:', `$ ${formatPriceStr(sale.monto_pendiente_usd)}`, width) + '\n';
    }

    // NOTA DE VENTA
    if (sale.nota && sale.nota.trim()) {
        t += lineStr + '\n';
        t += 'NOTA:\n';
        const words = sale.nota.toUpperCase().split(' ');
        let currentLine = "";
        words.forEach(word => {
            if ((currentLine + word).length < width) {
                currentLine += (currentLine ? " " : "") + word;
            } else {
                t += currentLine + '\n';
                currentLine = word;
            }
        });
        if (currentLine) t += currentLine + '\n';
    }

    const hash = 'Z' + Math.random().toString(36).substring(2, 6).toUpperCase() + String(sale.id).padStart(4, '0');
    t += '\n' + hash.padStart(width, ' ') + '\n';

    // Footer
    const footerLines = (settings.printFooter || "").split('\n').filter(l => l.trim());
    footerLines.forEach(l => {
        t += ' '.repeat(Math.max(0, Math.floor((width - l.trim().length) / 2))) + l.trim().toUpperCase() + '\n';
    });
    t += '\n' + ' '.repeat(Math.max(0, Math.floor((width - 19) / 2))) + 'DOCUMENTO NO FISCAL\n\n\n\n';

    return t;
}

/**
 * Función principal para re-imprimir una venta
 */

async function directPrintSale(saleId, forceDirect = false) {
  console.log('[Reprint] Iniciando impresión directa de venta:', saleId);
  
  try {
    // 1. Obtener configuración de impresión PRIMERO para decidir modo
    const settingsResp = await fetch('/api/print-settings');
    const settings = settingsResp.ok ? await settingsResp.json() : {};

    // NUEVO: Si el modo es vista previa, redirigir (a menos que estemos forzando impresión directa)
    if (!forceDirect && settings.printMode === 'preview') {
      console.log('[Reprint] Modo Vista Previa detectado, redirigiendo...');
      if (typeof window.showTicketPreview === 'function') {
        return window.showTicketPreview(saleId);
      } else {
          console.warn('showTicketPreview no encontrada, procediendo con impresión directa.');
      }
    }

    // 2. Obtener detalles de la venta (si no se redirigió a preview)
    const resp = await fetch(`/api/sales/${saleId}/details`);
    if (!resp.ok) throw new Error('No se pudo obtener la información de la venta.');
    const data = await resp.json();
    const { sale, products, cliente, payments } = data;

    // 3. Preparar constantes de ESC/POS
    const ESC = 0x1B;
    const GS = 0x1D;
    const CENTER = new Uint8Array([ESC, 0x61, 0x01]);
    const LEFT = new Uint8Array([ESC, 0x61, 0x00]);
    const INIT = new Uint8Array([ESC, 0x40]);
    // MODO FEED AND CUT (65): Avanza el papel la distancia exacta hasta la cuchilla y corta.
    const FEED_AND_CUT = new Uint8Array([GS, 0x56, 0x41, 0x00]); 

    const width = Number(settings.ticketSize || 80) === 58 ? 32 : 48;



    const lineStr = '-'.repeat(width);

    // 4. Logo
    let logoBytes = new Uint8Array(0);
    if (settings.printLogo !== false && settings.logoPath) {
      let logoUrl = settings.logoPath;
      if (!logoUrl.startsWith('/') && !logoUrl.startsWith('http')) {
        logoUrl = `/uploads/${logoUrl.split(/[\\/]/).pop()}`;
      }
      const lb = await logoToEscPos(logoUrl, 192); // Mitad de tamaño como pidió el usuario
      if (lb) logoBytes = lb;
    }

    // 5. QR (Nativo ESC/POS igual que pos.js)
    let qrBytes = new Uint8Array(0);
    const qrText = settings.printQrContent || "";
    if (settings.printQr !== false && qrText) {
      const qrLen = qrText.length + 3;
      const pL = qrLen & 0xFF;
      const pH = (qrLen >> 8) & 0xFF;

      const qrCmds = new Uint8Array([
        0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // Modelo 2
        0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06,       // Tamaño 6
        0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30,       // Error Correction L
        0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30            // Store data
      ]);
      const qrData = encodeToSingleByte(qrText);
      const qrPrint = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]); // Print data
      
      qrBytes = new Uint8Array(qrCmds.length + qrData.length + qrPrint.length + 4); 
      let qOffset = 0;
      qrBytes.set([0x0A], qOffset++); // Salto antes
      qrBytes.set(qrCmds, qOffset); qOffset += qrCmds.length;
      qrBytes.set(qrData, qOffset); qOffset += qrData.length;
      qrBytes.set(qrPrint, qOffset); qOffset += qrPrint.length;
      qrBytes.set([0x0A, 0x0A, 0x0A], qOffset); // Saltos después
    }

    // 6. Construir Texto
    const bcvMoment = Number(sale.total_ves / (sale.total_usd_bcv || 1));
    const saleDate = new Date(sale.creado_en);
    const dateStr = saleDate.toLocaleDateString('es-VE');
    const timeStr = saleDate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    let t1 = "";
    // Header
    const headerLines = (settings.printHeader || "").split('\n').filter(l => l.trim());
    headerLines.forEach(l => {
      t1 += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l.toUpperCase() + '\n';
    });
    
    // Biz info
    if (settings.businessRIF) t1 += ' '.repeat(Math.max(0, Math.floor((width - settings.businessRIF.length - 5) / 2))) + `RIF: ${settings.businessRIF.toUpperCase()}\n`;
    if (settings.businessAddress) {
      settings.businessAddress.split('\n').forEach(l => {
        t1 += ' '.repeat(Math.max(0, Math.floor((width - l.trim().length) / 2))) + l.trim().toUpperCase() + '\n';
      });
    }
    if (settings.businessPhone) t1 += ' '.repeat(Math.max(0, Math.floor((width - settings.businessPhone.length - 5) / 2))) + `TEL: ${settings.businessPhone}\n`;
    t1 += '\n';

    // Cliente
    const rif = cliente ? (cliente.cedula || 'V-000000000') : 'V-000000000';
    const name = cliente ? (cliente.nombre || 'CONSUMIDOR FINAL') : 'CONSUMIDOR FINAL';
    const dir = cliente ? (cliente.direccion || 'N/A') : 'N/A';
    const tel = cliente ? (cliente.telefono || 'N/A') : 'N/A';

    t1 += `RIF/C.I.: ${rif}\n`;

    // RAZON SOCIAL Multilínea
    const labelRS = "RAZON SOCIAL: ";
    let currentRS = name.toUpperCase();
    if (labelRS.length + currentRS.length > width) {
        t1 += labelRS + '\n';
        const wordsRS = currentRS.split(' ');
        let lineRS = '';
        wordsRS.forEach(w => {
            if ((lineRS + w).length < width) {
                lineRS += (lineRS ? ' ' : '') + w;
            } else {
                if (lineRS) t1 += lineRS + '\n';
                lineRS = w;
            }
        });
        if (lineRS) t1 += lineRS + '\n';
    } else {
        t1 += labelRS + currentRS + '\n';
    }

    // DIRECCION Multilínea
    const labelDir = "DIRECCION: ";
    let currentDir = dir.toUpperCase();
    if (labelDir.length + currentDir.length > width) {
        t1 += labelDir + '\n';
        const wordsDir = currentDir.split(' ');
        let lineDir = '';
        wordsDir.forEach(w => {
            if ((lineDir + w).length < width) {
                lineDir += (lineDir ? ' ' : '') + w;
            } else {
                if (lineDir) t1 += lineDir + '\n';
                lineDir = w;
            }
        });
        if (lineDir) t1 += lineDir + '\n';
    } else {
        t1 += labelDir + currentDir + '\n';
    }

    t1 += `TELEFONO: ${tel}\n`;
    t1 += `REF. INTERNA: ${String(sale.id).padStart(10, '0')}\n`;
    t1 += `VENDEDOR: 01\n`;
    t1 += ' '.repeat(Math.max(0, Math.floor((width - 6) / 2))) + 'RECIBO\n\n';

    t1 += formatLine('RECIBO:', String(sale.id).padStart(8, '0'), width) + '\n';
    t1 += formatLine(`FECHA: ${dateStr}`, `HORA: ${timeStr}`, width) + '\n';
    t1 += lineStr + '\n';

    // Productos
    products.forEach(p => {
      const isExempt = p.exento_iva === 1;
      const indicator = isExempt ? '(E)' : '(G)';
      const pName = (p.producto_nombre || 'Producto').toUpperCase() + ` ${indicator}`;
      
      // Multi-line name support
      const words = pName.split(' ');
      let currentLine = '';
      words.forEach(word => {
        if ((currentLine + word).length < width) {
          currentLine += (currentLine ? ' ' : '') + word;
        } else {
          if (currentLine) t1 += currentLine + '\n';
          currentLine = word;
        }
      });
      if (currentLine) t1 += currentLine + '\n';

      const qty = Number(p.cantidad || 0);
      const priceVes = Number(p.precio_unitario_ves || 0);
      const totalItemVes = qty * priceVes;
      const totalItemUsd = totalItemVes / bcvMoment;
      
      const qtyStr = formatPriceStr(qty);
      const priceStr = formatPriceStr(priceVes);
      const right = `Bs ${formatPriceStr(totalItemVes)} ($ ${totalItemUsd.toFixed(2)})`;
      const left = `${qtyStr} x ${priceStr}`;
      
      t1 += formatLine(left, right, width) + '\n';
    });

    t1 += lineStr + '\n';
    t1 += formatLine('SUBTTL', `Bs ${formatPriceStr(sale.total_ves)}`, width) + '\n';
    t1 += formatLine('SUBTTL ($)', `$ ${formatPriceStr(sale.total_usd_bcv)}`, width) + '\n';
    t1 += lineStr + '\n';

    // Impuesto
    const tax = sale.impuesto_total || 0;
    if (tax > 0) {
      const base = sale.total_ves - tax;
      t1 += formatLine('BI G16,00%', `Bs ${formatPriceStr(base)}`, width) + '\n';
      t1 += formatLine('IVA G16,00%', `Bs ${formatPriceStr(tax)}`, width) + '\n';
      t1 += lineStr + '\n';
    }

    // Pagos
    payments.forEach(pay => {
      let m = pay.metodo === 'VES_EFECTIVO' ? 'EFECTIVO' :
             pay.metodo === 'USD_EFECTIVO' ? 'EFE DIVISA' : pay.metodo;
      t1 += formatLine(m, `Bs ${formatPriceStr(pay.monto_en_ves)}`, width) + '\n';
    });

    t1 += lineStr + '\n';
    t1 += formatLine('TOTAL', `Bs ${formatPriceStr(sale.total_ves)}`, width) + '\n';
    t1 += formatLine('TOTAL ($)', `$ ${formatPriceStr(sale.total_usd_bcv)}`, width) + '\n';

    if (sale.monto_pendiente_usd > 0) {
      t1 += lineStr + '\n';
      const pendVes = sale.monto_pendiente_usd * bcvMoment;
      t1 += formatLine('PENDIENTE Bs:', `Bs ${formatPriceStr(pendVes)}`, width) + '\n';
      t1 += formatLine('PENDIENTE $:', `$ ${formatPriceStr(sale.monto_pendiente_usd)}`, width) + '\n';
    }

    const hash = 'Z' + Math.random().toString(36).substring(2, 6).toUpperCase() + String(sale.id).padStart(4, '0');
    t1 += hash.padStart(width, ' ') + '\n';

    const footerLines = (settings.printFooter || "").split('\n').filter(l => l.trim());
    footerLines.forEach(l => {
      t1 += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l.toUpperCase() + '\n';
    });
    t1 += '\n' + ' '.repeat(Math.max(0, Math.floor((width - 19) / 2))) + 'DOCUMENTO NO FISCAL\n';

    // 7. Combinar y enviar

    const ep = window.electronPrinter;
    // --- PUENTE DE IMPRESIÓN UNIVERSAL (Reprint) ---
    const universalPrinter = {
      printTextTicket: async (opts) => {
        if (ep && typeof ep.printTextTicket === 'function') {
          return await ep.printTextTicket(opts);
        } else {
          console.log('[REMOTE] Intentando reimpresión remota...');
          try {
            const resp = await fetch('/api/print/remote', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'text', options: opts })
            });
            return await resp.json();
          } catch (err) {
            return { ok: false, error: 'No se pudo conectar con la impresora remota: ' + err.message };
          }
        }
      }
    };

    const part1Bytes = encodeToSingleByte(t1);
    
    const combined = new Uint8Array(
      INIT.length + 
      logoBytes.length + 
      part1Bytes.length + 
      (qrBytes.length ? (CENTER.length + qrBytes.length + LEFT.length) : 0) +
      FEED_AND_CUT.length
    );

    let offset = 0;
    combined.set(INIT, offset); offset += INIT.length;
    if (logoBytes.length) { combined.set(logoBytes, offset); offset += logoBytes.length; }
    combined.set(part1Bytes, offset); offset += part1Bytes.length;
    if (qrBytes.length) {
      combined.set(CENTER, offset); offset += CENTER.length;
      combined.set(qrBytes, offset); offset += qrBytes.length;
      combined.set(LEFT, offset); offset += LEFT.length;
    }
    combined.set(FEED_AND_CUT, offset);

    const printResp = await universalPrinter.printTextTicket({
      printerName: settings.printerName || undefined,
      type: 'RAW',
      binary: Array.from(combined),
      text: '' // Avoid "No hay contenido" error
    });

    if (printResp && printResp.ok) {
      console.log('[Reprint] Impresión enviada con éxito.');
    } else {
      throw new Error(printResp.error || 'Error desconocido al imprimir.');
    }

  } catch (e) {
    console.error('[Reprint] Error:', e);
    if (window.showGlobalAlert) window.showGlobalAlert(`Error al imprimir el ticket: ${e.message}`);
    else alert(`Error al imprimir el ticket: ${e.message}`);
  }
}

async function showTicketPreview(saleId) {
    const modal = document.getElementById('ticket-preview-modal');
    const contentEl = document.getElementById('ticket-preview-content');
    const btnPrint = document.getElementById('btn-print-ticket-preview');
    const btnClose = document.getElementById('btn-close-ticket-preview');
    const btnCancel = document.getElementById('btn-cancel-ticket-preview');

    if (!modal || !contentEl) {
        console.error('Modal de preview no encontrado.');
        return;
    }

    contentEl.textContent = "Cargando ticket...";
    modal.classList.remove('hidden');

    try {
        const resp = await fetch(`/api/sales/${saleId}/details`);
        if (!resp.ok) throw new Error('No se pudo obtener la información de la venta.');
        const data = await resp.json();
        const { sale, products, cliente, payments } = data;

        const settingsResp = await fetch('/api/print-settings');
        let settings = {};
        if (settingsResp.ok) settings = await settingsResp.json();
        else {
            const fallbackResp = await fetch('/api/settings/print');
            settings = fallbackResp.ok ? await fallbackResp.json() : {};
        }

        const width = Number(settings.ticketSize || 80) === 58 ? 32 : 48;
        
        // Ensure strictly monospace so the shrink-wrap works perfectly.
        contentEl.style.fontFamily = "'Courier New', Courier, monospace";

        const textTicket = generateTicketText(sale, products, cliente, payments, settings, width);
        contentEl.textContent = textTicket;

        // Logo
        const logoContainer = document.getElementById('ticket-preview-logo-container');
        const logoImg = document.getElementById('ticket-preview-logo');
        if (settings.printLogo !== false && settings.logoPath && logoContainer && logoImg) {
            logoImg.src = settings.logoPath + '?t=' + Date.now();
            logoContainer.classList.remove('hidden');
        } else if (logoContainer) {
            logoContainer.classList.add('hidden');
        }

        // QR Code
        const qrContainer = document.getElementById('ticket-preview-qr-container');
        const qrCanvas = document.getElementById('qr-canvas');
        if (settings.printQr !== false && qrContainer && qrCanvas && (settings.printQrContent || '')) {
            const qrText = settings.printQrContent || '';
            try {
                const qrResp = await fetch(`/api/utils/qrcode?text=${encodeURIComponent(qrText)}`);
                const qrData = await qrResp.json();
                if (qrData.success && qrData.qrDataURL) {
                    const ctxQr = qrCanvas.getContext('2d');
                    const imgQr = new Image();
                    imgQr.onload = () => {
                        qrCanvas.width = 150;
                        qrCanvas.height = 150;
                        ctxQr.drawImage(imgQr, 0, 0, 150, 150);
                        qrContainer.classList.remove('hidden');
                    };
                    imgQr.src = qrData.qrDataURL;
                } else {
                    qrContainer.classList.add('hidden');
                }
            } catch (e) {
                console.error('Error al generar QR para preview:', e);
                qrContainer.classList.add('hidden');
            }
        } else if (qrContainer) {
            qrContainer.classList.add('hidden');
        }

        // Clone button to remove previous listeners
        const newBtnPrint = btnPrint.cloneNode(true);
        btnPrint.parentNode.replaceChild(newBtnPrint, btnPrint);

        newBtnPrint.onclick = async () => {
            newBtnPrint.disabled = true;
            newBtnPrint.textContent = "Imprimiendo...";
            await directPrintSale(saleId, true);
            newBtnPrint.disabled = false;
            newBtnPrint.textContent = "Imprimir Ticket";
            modal.classList.add('hidden');
        };

        const btnSavePDF = document.getElementById('btn-pdf-ticket-preview');
        if (btnSavePDF) {
            btnSavePDF.onclick = async () => {
                btnSavePDF.disabled = true;
                const originalText = btnSavePDF.textContent;
                btnSavePDF.textContent = "Generando...";

                const html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            @page {
                                margin: 0;
                            }
                            body { 
                                font-family: 'Courier New', Courier, monospace; 
                                font-size: 11px; 
                                line-height: 1.2;
                                width: 80mm; 
                                margin: 0 auto; 
                                padding: 20mm 5mm;
                                background: #fff;
                                color: #000;
                            }
                            pre { 
                                white-space: pre; 
                                margin: 0;
                                display: block;
                            }
                        </style>
                    </head>
                    <body>
                        <pre>${textTicket}</pre>
                    </body>
                    </html>
                `;

                if (window.electronPrinter && window.electronPrinter.savePDF) {
                  const res = await window.electronPrinter.savePDF({
                      html,
                      fileName: `Recibo_${sale.id}_${new Date().getTime()}.pdf`
                  });

                  if (!res.ok && res.error !== 'Operación cancelada por el usuario.') {
                      if (window.showGlobalAlert) window.showGlobalAlert("Error al guardar PDF: " + res.error);
                      else alert("Error al guardar PDF: " + res.error);
                  }
                  if (res.ok) modal.classList.add('hidden');
                } else {
                  if (window.showGlobalAlert) window.showGlobalAlert("El guardado de PDF solo está disponible en la PC principal.");
                  else alert("El guardado de PDF solo está disponible en la PC principal.");
                }

                btnSavePDF.disabled = false;
                btnSavePDF.textContent = originalText;
            };
        }

        const closeFunc = () => modal.classList.add('hidden');
        btnClose.onclick = closeFunc;
        btnCancel.onclick = closeFunc;

    } catch (e) {
        console.error('[Preview] Error:', e);
        contentEl.textContent = "Error al cargar la información: " + e.message;
    }
}

// Exportar globalmente
window.showTicketPreview = showTicketPreview;
window.directPrintSale = directPrintSale;
window.generateTicketText = generateTicketText;
