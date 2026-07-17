const MAX_LINES = 250;
const MAX_QUANTITY = 1_000_000;
const PRICE_TOLERANCE = 0.01;

function finiteNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (!allowZero && number === 0)) {
    throw new Error(`${field} inválido.`);
  }
  return number;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function rateForCurrency(currency, rates) {
  if (currency === 'VES') return 1;
  const rate = Number(rates[currency]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Tasa ${currency} inválida.`);
  return rate;
}

function internalCostVes(product, rates) {
  const cost = finiteNumber(product.costo, 'Costo de producto');
  return round4(cost * rateForCurrency(product.moneda_costo || 'VES', rates));
}

function canonicalProductPrice(product, rates) {
  const costVes = internalCostVes(product, rates);
  const percentage = finiteNumber(product.porcentaje_ganancia, 'Porcentaje de ganancia') / 100;
  const method = Number(rates.CALC_METHOD) || 1;
  if (method === 2) {
    if (percentage >= 1) return round4(costVes);
    return round4(costVes / (1 - percentage));
  }
  return round4(costVes * (1 + percentage));
}

function canonicalPresentationPrice(presentation, rates) {
  const storedPrice = finiteNumber(presentation.precio, 'Precio de presentación');
  if (storedPrice > 0) {
    return round4(storedPrice * rateForCurrency(presentation.moneda || 'VES', rates));
  }
  return round4(finiteNumber(presentation.precio_ves, 'Precio legacy de presentación'));
}

function requestedOrCanonicalPrice(requested, canonical, allowOverride) {
  if (requested === undefined || requested === null || requested === '') return canonical;
  const requestedPrice = finiteNumber(requested, 'Precio solicitado', { allowZero: false });
  if (Math.abs(requestedPrice - canonical) <= PRICE_TOLERANCE) return canonical;
  if (!allowOverride) throw new Error('El precio solicitado no coincide con el precio autorizado.');
  return round4(requestedPrice);
}

function taxForGross(gross, exempt, taxRate, taxMode) {
  if (exempt || taxRate <= 0) return 0;
  if (taxMode === 'EXCLUDED') return round2(gross * taxRate);
  return round2(gross - (gross / (1 + taxRate)));
}

function buildCanonicalLines({ cart, rates, getProduct, getPresentation, allowPriceOverride = false }) {
  if (!Array.isArray(cart) || cart.length === 0 || cart.length > MAX_LINES) {
    throw new Error('Carrito vacío o con demasiadas líneas.');
  }
  const taxRate = finiteNumber(rates.IVA_PERCENTAGE ?? 16, 'IVA') / 100;
  const taxMode = rates.IVA_MODE === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED';
  const stockRequirements = new Map();
  const lines = [];

  for (const item of cart) {
    const saleQuantity = finiteNumber(item.quantity, 'Cantidad', {
      min: 0,
      max: MAX_QUANTITY,
      allowZero: false,
    });
    const isFreeSale = typeof item.id === 'string' && item.id.startsWith('vl-');

    if (isFreeSale) {
      if (!allowPriceOverride) throw new Error('La venta libre requiere autorización administrativa.');
      const unitPriceVes = finiteNumber(item.priceVes, 'Precio de venta libre', { allowZero: false });
      const costUnitVes = finiteNumber(item.costVes || 0, 'Costo de venta libre');
      const name = String(item.name || '').trim().slice(0, 160);
      if (!name) throw new Error('La venta libre requiere nombre.');
      const gross = round2(saleQuantity * unitPriceVes);
      const exempt = !!item.exento_iva;
      const tax = taxForGross(gross, exempt, taxRate, taxMode);
      lines.push({
        productId: null,
        quantity: round4(saleQuantity),
        saleQuantity: round4(saleQuantity),
        unitPriceVes: round4(unitPriceVes),
        costUnitVes: round4(costUnitVes),
        name,
        exempt,
        presentationId: null,
        presentationName: null,
        unitsBase: 1,
        priceSource: 'FREE',
        priceCurrency: 'VES',
        gross,
        tax,
      });
      continue;
    }

    const productId = Number.parseInt(item.id, 10);
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Producto inválido.');
    const product = getProduct(productId);
    if (!product || Number(product.activo ?? 1) !== 1) throw new Error(`Producto ${productId} no disponible.`);

    let presentation = null;
    let unitsBase = 1;
    let canonicalSaleUnitPrice = canonicalProductPrice(product, rates);
    let priceSource = 'PRODUCT';
    let priceCurrency = product.moneda_costo || 'VES';
    if (item.presentationId !== undefined && item.presentationId !== null && item.presentationId !== '') {
      const presentationId = Number.parseInt(item.presentationId, 10);
      if (!Number.isSafeInteger(presentationId) || presentationId <= 0) {
        throw new Error('Presentación inválida.');
      }
      presentation = getPresentation(presentationId);
      if (!presentation || Number(presentation.activo ?? 1) !== 1 || Number(presentation.producto_id) !== productId) {
        throw new Error('La presentación no pertenece al producto o está inactiva.');
      }
      unitsBase = finiteNumber(presentation.unidades_base, 'Unidades base', {
        min: 0,
        max: MAX_QUANTITY,
        allowZero: false,
      });
      canonicalSaleUnitPrice = canonicalPresentationPrice(presentation, rates);
      priceSource = 'PRESENTATION';
      priceCurrency = presentation.moneda || 'VES';
    }

    const saleUnitPrice = requestedOrCanonicalPrice(item.priceVes, canonicalSaleUnitPrice, allowPriceOverride);
    const stockQuantity = round4(saleQuantity * unitsBase);
    const required = round4((stockRequirements.get(productId) || 0) + stockQuantity);
    stockRequirements.set(productId, required);

    const unitPriceVes = round4(saleUnitPrice / unitsBase);
    const costUnitVes = internalCostVes(product, rates);
    const gross = round2(stockQuantity * unitPriceVes);
    const exempt = Number(product.exento_iva ?? 1) === 1;
    const tax = taxForGross(gross, exempt, taxRate, taxMode);
    lines.push({
      productId,
      quantity: stockQuantity,
      saleQuantity: round4(saleQuantity),
      unitPriceVes,
      costUnitVes,
      name: presentation ? `${product.nombre} - ${presentation.nombre}` : product.nombre,
      exempt,
      presentationId: presentation ? presentation.id : null,
      presentationName: presentation ? presentation.nombre : null,
      unitsBase: round4(unitsBase),
      priceSource,
      priceCurrency,
      gross,
      tax,
    });
  }

  for (const [productId, required] of stockRequirements) {
    const product = getProduct(productId);
    if (finiteNumber(product.stock, 'Stock') < required) {
      throw new Error(`Stock insuficiente para ${product.nombre}.`);
    }
  }

  const subtotalVes = round2(lines.reduce((sum, line) => sum + line.gross, 0));
  const taxTotalVes = round2(lines.reduce((sum, line) => sum + line.tax, 0));
  const totalVes = taxMode === 'EXCLUDED' ? round2(subtotalVes + taxTotalVes) : subtotalVes;
  const bcv = rateForCurrency('BCV', rates);
  return {
    lines,
    subtotalVes,
    taxTotalVes,
    totalVes,
    totalUsd: round4(totalVes / bcv),
    taxMode,
    bcv,
  };
}

function paymentRate(method, rates, customRates) {
  if (method.moneda === 'VES') return 1;
  if (method.tipo_tasa === 'FIJA') {
    return finiteNumber(method.tasa_valor, 'Tasa fija', { allowZero: false });
  }
  if (method.tipo_tasa === 'PERSONALIZADA') {
    return finiteNumber(customRates[method.tasa_personalizada_key], 'Tasa personalizada', { allowZero: false });
  }
  const key = method.tipo_tasa === 'PARALELO' ? 'PARALELO'
    : (method.moneda === 'COP' ? 'COP' : 'BCV');
  return rateForCurrency(key, rates);
}

function buildCanonicalPayments({ payments, methods, rates, customRates = {} }) {
  if (!Array.isArray(payments) || payments.length > 50) throw new Error('Pagos inválidos.');
  const methodMap = new Map(methods.filter((method) => Number(method.activo) === 1).map((method) => [method.key, method]));
  const normalized = payments.map((payment) => {
    const method = methodMap.get(payment.method);
    if (!method) throw new Error(`Método de pago inválido: ${payment.method}.`);
    const amountReceived = finiteNumber(payment.amountReceived, 'Monto recibido', { allowZero: false });
    const conversionRate = paymentRate(method, rates, customRates);
    return {
      method: method.key,
      amountReceived: round4(amountReceived),
      amountInVes: round2(amountReceived * conversionRate),
      conversionRate: round4(conversionRate),
    };
  });
  return {
    payments: normalized,
    totalPaidVes: round2(normalized.reduce((sum, payment) => sum + payment.amountInVes, 0)),
  };
}

module.exports = {
  PRICE_TOLERANCE,
  round2,
  round4,
  internalCostVes,
  canonicalProductPrice,
  canonicalPresentationPrice,
  buildCanonicalLines,
  buildCanonicalPayments,
};
