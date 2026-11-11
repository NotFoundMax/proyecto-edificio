/**
 * calculator.js — Lógica pura de prorrateo por m² para "Los Castaños 104"
 *
 * Reglas de negocio:
 *  - Área total del edificio: 1040.98 m² (5 departamentos).
 *  - Prorrateo: (m2_dpto / 1040.98) * monto_gasto, redondeado a 2 decimales.
 *  - Ajuste de céntimos residuales: la suma de las 5 cuotas debe cuadrar
 *    al 100.00% exacto con el gasto total.
 *  - Semáforo de cuadre: Total Gastos == Total Cuotas == Total Pagos.
 */

const TOTAL_M2_EDIFICIO = 1040.98;

const Calculator = {
  /**
   * Redondea un número a 2 decimales usando enteros (evita errores de float).
   */
  round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  },

  /**
   * Formatea un monto en soles peruanos: "S/ 1,250.00"
   */
  formatMoney(amount) {
    const n = Number(amount) || 0;
    return 'S/ ' + n.toLocaleString('es-PE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  },

  /**
   * Calcula el prorrateo de un gasto entre departamentos por m².
   *
   * @param {number} montoGasto - Monto total del gasto.
   * @param {Array<{id, m2}>} departamentos - Lista de departamentos con su área en m².
   * @returns {Array<{id, m2, coeficiente, cuota}>} - Cuota prorrateada por departamento,
   *          ajustada para que la suma cuadre al centavo.
   */
  prorratear(montoGasto, departamentos) {
    const monto = this.round2(montoGasto);
    if (!departamentos || departamentos.length === 0) return [];

    // Calcular cuotas brutas redondeadas
    const filas = departamentos.map(d => {
      const coef = (d.m2 / TOTAL_M2_EDIFICIO) * 100;
      const cuotaBruta = (d.m2 / TOTAL_M2_EDIFICIO) * monto;
      return {
        id: d.id,
        nombre: d.nombre || d.departamento || String(d.id),
        m2: this.round2(d.m2),
        coeficiente: this.round2(coef),
        cuota: this.round2(cuotaBruta)
      };
    });

    // Ajuste de céntimos residuales: la suma debe ser exactamente el monto
    const sumaActual = this.round2(filas.reduce((s, f) => s + f.cuota, 0));
    const residual = this.round2(monto - sumaActual);

    if (residual !== 0) {
      // Asignar el residual al departamento con mayor área (mayor peso)
      const idxMayor = filas.reduce((maxIdx, f, i, arr) =>
        f.m2 > arr[maxIdx].m2 ? i : maxIdx, 0);
      filas[idxMayor].cuota = this.round2(filas[idxMayor].cuota + residual);
    }

    return filas;
  },

  /**
   * Verifica el cuadre aritmético: Total Gastos == Total Cuotas == Total Pagos.
   *
   * @param {number} totalGastos
   * @param {number} totalCuotas
   * @param {number} totalPagos
   * @returns {{ cuadra: boolean, diferencias: {gastosVsCuotas, cuotasVsPagos, gastosVsPagos}, semaforo: 'verde'|'ambar'|'rojo' }}
   */
  verificarCuadre(totalGastos, totalCuotas, totalPagos) {
    const g = this.round2(totalGastos);
    const c = this.round2(totalCuotas);
    const p = this.round2(totalPagos);

    const diffGC = this.round2(g - c);
    const diffCP = this.round2(c - p);
    const diffGP = this.round2(g - p);

    const cuadra = diffGC === 0 && diffCP === 0;

    let semaforo = 'verde';
    if (!cuadra) semaforo = 'rojo';
    else if (p < c) semaforo = 'ambar'; // cuotas emitidas pero pagos incompletos

    return {
      cuadra,
      diferencias: {
        gastosVsCuotas: diffGC,
        cuotasVsPagos: diffCP,
        gastosVsPagos: diffGP
      },
      semaforo
    };
  },

  /**
   * Calcula el consumo de agua individual por departamento (suma directa, sin prorratear).
   *
   * @param {Array<{id, consumoAgua}>} lecturas - Lecturas de agua por departamento.
   * @returns {number} Total de consumo de agua.
   */
  totalAgua(lecturas) {
    return this.round2((lecturas || []).reduce((s, l) => s + (Number(l.consumoAgua) || 0), 0));
  },

  /**
   * Genera el desglose completo de un mes: prorrateo de gastos comunes + agua individual.
   *
   * @param {number} totalGastosComunes - Total de gastos comunes del mes.
   * @param {Array<{id, nombre, m2, consumoAgua}>} departamentos
   * @returns {Array<{id, nombre, m2, coeficiente, gastoComun, consumoAgua, totalPagar}>}
   */
  desgloseMes(totalGastosComunes, departamentos) {
    const prorrateo = this.prorratear(totalGastosComunes, departamentos);
    return prorrateo.map(fila => {
      const depto = (departamentos || []).find(d => d.id === fila.id);
      const agua = depto ? this.round2(Number(depto.consumoAgua) || 0) : 0;
      return {
        ...fila,
        consumoAgua: agua,
        totalPagar: this.round2(fila.cuota + agua)
      };
    });
  },

  /**
   * Verifica si un pago supera la cuota pendiente (prevención de sobrepagos).
   *
   * @param {number} montoPago
   * @param {number} cuotaPendiente
   * @returns {{ sobrepago: boolean, excedente: number }}
   */
  verificarSobrepago(montoPago, cuotaPendiente) {
    const pago = this.round2(montoPago);
    const pendiente = this.round2(cuotaPendiente);
    const excedente = this.round2(pago - pendiente);
    return {
      sobrepago: excedente > 0,
      excedente: excedente > 0 ? excedente : 0
    };
  }
};

// Exportar para uso en módulos ES6 (si se usa type="module")
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Calculator, TOTAL_M2_EDIFICIO };
}
