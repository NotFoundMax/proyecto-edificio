const CATEGORIAS = {
    porteria: { label: 'Portería', icon: '' },
    descansero: { label: 'Descansero', icon: '' },
    mantenimiento: { label: 'Mantenimiento', icon: '' },
    administracion: { label: 'Administración', icon: '' },
    limpieza: { label: 'Limpieza', icon: '' },
    jardineria: { label: 'Jardinería', icon: '' },
    fumigacion: { label: 'Fumigación', icon: '' },
    ascensores: { label: 'Mant. Ascensores', icon: '' },
    puerta: { label: 'Mant. Puerta Garaje', icon: '' },
    tanque: { label: 'Mant. Tanque Agua', icon: '' },
    tuberia: { label: 'Tubería y Válvulas', icon: '' },
    intercomunicador: { label: 'Intercomunicador', icon: '' },
    agua: { label: 'Servicio de Agua', icon: '' },
    luz: { label: 'Servicio de Luz', icon: '' },
    materiales: { label: 'Materiales', icon: '' },
    vacaciones: { label: 'Vacaciones', icon: '' },
    gratificaciones: { label: 'Gratificaciones', icon: '' },
    arreglos: { label: 'Arreglos Varios', icon: '' },
    otros: { label: 'Otros', icon: '' }
};

const FRECUENCIAS = {
    mensual: { label: 'Mensual', meses: 1 },
    trimestral: { label: 'Trimestral', meses: 3 },
    semestral: { label: 'Semestral', meses: 6 },
    anual: { label: 'Anual', meses: 12 },
    unico: { label: 'Único', meses: 0 },
    extraordinario: { label: 'Extraordinario', meses: 0 }
};

const Calculos = {
    formatMoney(amount) {
        const moneda = DB.getMoneda();
        return moneda + ' ' + amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    getMesLabel(mesKey) {
        const [year, month] = mesKey.split('-');
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return `${months[parseInt(month) - 1]} ${year}`;
    },

    getCurrentMes() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    },

    shiftMes(mesKey, delta) {
        const [year, month] = mesKey.split('-').map(Number);
        const date = new Date(year, month - 1 + delta, 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    },

    getGastoMensualEquivalente(gasto) {
        if (gasto.origen === 'fijo') return gasto.monto;
        const freq = FRECUENCIAS[gasto.frecuencia];
        if (!freq || freq.meses === 0) return gasto.monto;
        return gasto.monto / freq.meses;
    },


    _sortDeptos(list) {
        return [...(list||[])].sort((a,b)=>{
            const da = String(a.departamento || '').trim();
            const db = String(b.departamento || '').trim();
            const na = parseInt(da.replace(/\D/g,''),10);
            const nb = parseInt(db.replace(/\D/g,''),10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return nb - na;
            if (da !== db) return db.localeCompare(da, 'es', {numeric:true, sensitivity:'base'});
            return 0;
        });
    },

    calcTotalGastosMes(mes) {
        const gastos = DB.getGastos({ mes });
        return gastos.reduce((sum, g) => sum + this.getGastoMensualEquivalente(g), 0);
    },

    calcTotalGastosPagados(mes) {
        const gastos = DB.getGastos({ mes });
        return gastos.filter(g => g.pagado).reduce((sum, g) => sum + this.getGastoMensualEquivalente(g), 0);
    },

    calcGastosNormales(mes) {
        const gastos = DB.getGastos({ mes });
        return gastos.filter(g => g.frecuencia !== 'extraordinario');
    },

    calcTotalGastosNormales(mes) {
        return this.calcGastosNormales(mes).reduce((sum, g) => sum + this.getGastoMensualEquivalente(g), 0);
    },

    calcTotalGastosNormalesPagados(mes) {
        return this.calcGastosNormales(mes).filter(g => g.pagado).reduce((sum, g) => sum + this.getGastoMensualEquivalente(g), 0);
    },

    calcTotalGastosExtraordinarios(mes) {
        const gastos = DB.getGastos({ mes });
        return gastos.filter(g => g.frecuencia === 'extraordinario').reduce((sum, g) => sum + g.monto, 0);
    },

    calcTotalPagos(mes) {
        return DB.getPagos(mes).reduce((sum, p) => sum + p.monto, 0);
    },

    calcTotalCuotasMensuales() {
        return this._sortDeptos(DB.getPropietarios()).reduce((sum, p) => sum + (p.cuotaMensual || 0), 0);
    },

    calcBalanceCaja(mes) {
        const cajaMes = DB.getCajaMes(mes);
        const totalGastosNormales = this.calcTotalGastosNormales(mes);
        return cajaMes - totalGastosNormales;
    },

    calcTotalIngresosMes(mes) {
        const cuotasMensuales = this.calcTotalCuotasMensuales();
        const pagosGastos = this.calcTotalPagos(mes);
        return cuotasMensuales + pagosGastos;
    },

    calcDeficit(mes) {
        const cajaMes = DB.getCajaMes(mes);
        const totalGastos = this.calcTotalGastosNormales(mes);
        return cajaMes - totalGastos;
    },

    calcGastosPorCategoria(mes) {
        const gastos = DB.getGastos({ mes });
        const porCategoria = {};
        gastos.forEach(g => {
            if (!porCategoria[g.categoria]) porCategoria[g.categoria] = 0;
            porCategoria[g.categoria] += this.getGastoMensualEquivalente(g);
        });
        return porCategoria;
    },

    round2(n) {
        return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    },

    // Distribución exacta al centavo sobre el área prorrateable del mismo edificio (Σ m² de las unidades participantes).
    // El ajuste por redondeo (solo céntimos) se reparte por mayor resto, sin concentrarlo en un mismo departamento.
    distribuirGastoExacto(monto, propietarios, opts = {}) {
        const props = this._sortDeptos(propietarios || []);
        const m = this.round2(monto);
        if (!props.length || m === 0) return props.map(p => ({ id: p.id, valor: 0 }));
        const division = opts.division || 'proporcional';
        const n = props.length;
        const totalM2 = props.reduce((s, p) => s + (Number(p.m2) || 0), 0);

        let filas = props.map(p => {
            const m2 = Number(p.m2) || 0;
            let bruto = 0;
            if (division === 'igualitario') {
                bruto = n > 0 ? (m / n) : 0;
            } else {
                // Proporcional al área prorrateable del mismo edificio (unidades participantes)
                bruto = totalM2 > 0 ? (m2 / totalM2) * m : (n > 0 ? (m / n) : 0);
            }
            const valor = this.round2(bruto);
            return { id: p.id, m2, bruto, frac: bruto - valor, valor };
        });

        const suma = this.round2(filas.reduce((acc, f) => acc + f.valor, 0));
        let residual = this.round2(m - suma);
        const cents = Math.round(Math.abs(residual) * 100);
        if (cents !== 0 && filas.length) {
            const step = residual > 0 ? 0.01 : -0.01;
            const orden = filas
                .map((f, i) => ({ i, frac: f.frac }))
                .sort((a, b) => (step > 0 ? (b.frac - a.frac) : (a.frac - b.frac)) || (filas[b.i].m2 - filas[a.i].m2) || (a.i - b.i));
            for (let k = 0; k < cents; k++) {
                const idx = orden[k % orden.length].i;
                filas[idx].valor = this.round2(filas[idx].valor + step);
            }
        }

        // Verificación final (solo céntimos de redondeo)
        const suma2 = this.round2(filas.reduce((acc, f) => acc + f.valor, 0));
        residual = this.round2(m - suma2);
        if (residual !== 0 && filas.length) {
            const step = residual > 0 ? 0.01 : -0.01;
            const cents2 = Math.round(Math.abs(residual) * 100);
            for (let k = 0; k < cents2; k++) {
                const idx = k % filas.length;
                filas[idx].valor = this.round2(filas[idx].valor + step);
            }
        }

        return filas.map(f => ({ id: f.id, valor: f.valor }));
    },

    _calcGastoParaPropietario(gasto, propietario, totalCoef, numPropietarios, _ctx) {
        if (_ctx && _ctx.mapa && _ctx.mapa[propietario.id] != null) return _ctx.mapa[propietario.id];
        const equiv = this.getGastoMensualEquivalente(gasto);
        if (gasto.frecuencia === 'extraordinario' && gasto.division === 'igualitario') {
            const n = numPropietarios > 0 ? numPropietarios : 1;
            return this.round2(equiv / n);
        }
        const props = (_ctx && _ctx.propietarios) ? _ctx.propietarios : this._sortDeptos(DB.getPropietarios());
        const dist = this.distribuirGastoExacto(equiv, props, { division: 'proporcional' });
        const found = dist.find(d => d.id === propietario.id);
        return found ? found.valor : 0;
    },

    calcCuotaPropietario(propietario, mes) {
        const gastos = DB.getGastos({ mes });
        const propietarios = this._sortDeptos(DB.getPropietarios());
        const totalCoeficientes = propietarios.reduce((sum, p) => sum + p.coeficiente, 0);
        return gastos.reduce((sum, g) => {
            return sum + this._calcGastoParaPropietario(g, propietario, totalCoeficientes, propietarios.length);
        }, 0);
    },

    calcResumenPropietarios(mes) {
        const propietarios = this._sortDeptos(DB.getPropietarios());
        const pagos = DB.getPagos(mes);

        return propietarios.map(p => {
            const cuotaFija = p.cuotaMensual || 0;
            const pagado = pagos
                .filter(pg => pg.propietarioId === p.id)
                .reduce((sum, pg) => sum + pg.monto, 0);
            const saldo = cuotaFija - pagado;

            return {
                ...p,
                cuotaFija,
                cuota: cuotaFija,
                pagado,
                saldo,
                estado: saldo <= 0.01 ? 'pagado' : (pagado > 0 ? 'pendiente' : 'debe')
            };
        });
    },

    calcBalance() {
        const propietarios = this._sortDeptos(DB.getPropietarios());
        const meses = this.getMesesConDatos();

        const balances = {};
        propietarios.forEach(p => { balances[p.id] = 0; });

        meses.forEach(mes => {
            const gastos = DB.getGastos({ mes });
            const totalCoef = propietarios.reduce((sum, p) => sum + p.coeficiente, 0);
            const pagos = DB.getPagos(mes);

            propietarios.forEach(p => {
                const cuota = gastos.reduce((sum, g) => {
                    return sum + this._calcGastoParaPropietario(g, p, totalCoef, propietarios.length);
                }, 0);
                const pagado = pagos.filter(pg => pg.propietarioId === p.id).reduce((s, pg) => s + pg.monto, 0);
                balances[p.id] += pagado - cuota;
            });
        });

        return propietarios.map(p => ({
            ...p,
            balance: balances[p.id] || 0
        }));
    },


    // === Modelo unificado de cálculo mensual ===
    calcMes(mes) {
        const propietarios = this._sortDeptos(DB.getPropietarios());
        const pagos = (DB.getPagos ? DB.getPagos(mes) : []) || [];
        const gastos = (DB.getGastos ? DB.getGastos({ mes }) : []) || [];
        const totalCoef = propietarios.reduce((sum, p) => sum + (Number(p.coeficiente) || 0), 0);

        const comunesPorDepto = {}, comunesNormPorDepto = {}, extrasPorDepto = {};
        propietarios.forEach(p => { comunesPorDepto[p.id] = 0; comunesNormPorDepto[p.id] = 0; extrasPorDepto[p.id] = 0; });

        // Distribución exacta al centavo por gasto (Punto 5)
        const usaLuzFactura = !!(DB.getFacturaLuz && DB.getFacturaLuz(mes));
        let totalGastosPeriodo = 0;
        gastos.forEach(g => {
            if (usaLuzFactura && g.origen === 'luz') return; // luz se calcula por factura/lecturas (modelo tipo agua)
            const equiv = this.getGastoMensualEquivalente(g);
            totalGastosPeriodo = this.round2(totalGastosPeriodo + equiv);
            const division = (g.frecuencia === 'extraordinario' && g.division === 'igualitario') ? 'igualitario' : 'proporcional';
            const dist = this.distribuirGastoExacto(equiv, propietarios, { division });
            const mapa = {};
            dist.forEach(d => { mapa[d.id] = d.valor; });
            propietarios.forEach(p => {
                const val = mapa[p.id] != null ? mapa[p.id] : this._calcGastoParaPropietario(g, p, totalCoef, propietarios.length, { propietarios, mapa });
                comunesPorDepto[p.id] = this.round2((comunesPorDepto[p.id] || 0) + val);
                if (g.frecuencia === 'extraordinario') extrasPorDepto[p.id] = this.round2((extrasPorDepto[p.id] || 0) + val);
                else comunesNormPorDepto[p.id] = this.round2((comunesNormPorDepto[p.id] || 0) + val);
            });
        });

        // Agua de áreas comunes (medidor): se prorratea por coeficiente entre departamentos
        let aguaComunCosto = 0;
        try {
            const modalidadAgua = this.getAguaModalidad ? this.getAguaModalidad() : 'medidor';
            const infoAgua = this.getAguaFacturaInfo ? this.getAguaFacturaInfo(mes) : null;
            if (modalidadAgua === 'medidor' && infoAgua && (Number(infoAgua.costoComun) || 0) > 0.005) {
                aguaComunCosto = this.round2(Number(infoAgua.costoComun) || 0);
                totalGastosPeriodo = this.round2(totalGastosPeriodo + aguaComunCosto);
                const distAC = this.distribuirGastoExacto(aguaComunCosto, propietarios, { division: 'proporcional' });
                distAC.forEach(d => {
                    comunesPorDepto[d.id] = this.round2((comunesPorDepto[d.id] || 0) + d.valor);
                    comunesNormPorDepto[d.id] = this.round2((comunesNormPorDepto[d.id] || 0) + d.valor);
                });
            }
        } catch(e) { aguaComunCosto = 0; }

        // Luz de áreas comunes (medidor): se prorratea por coeficiente entre departamentos (modelo tipo agua)
        let luzComunCosto = 0;
        try {
            if (usaLuzFactura) {
                const modalidadLuz = this.getLuzModalidad ? this.getLuzModalidad() : 'medidor';
                const infoLuz = this.getLuzFacturaInfo ? this.getLuzFacturaInfo(mes) : null;
                if (modalidadLuz === 'medidor' && infoLuz && (Number(infoLuz.costoComun) || 0) > 0.005) {
                    luzComunCosto = this.round2(Number(infoLuz.costoComun) || 0);
                    totalGastosPeriodo = this.round2(totalGastosPeriodo + luzComunCosto);
                    const distLC = this.distribuirGastoExacto(luzComunCosto, propietarios, { division: 'proporcional' });
                    distLC.forEach(d => {
                        comunesPorDepto[d.id] = this.round2((comunesPorDepto[d.id] || 0) + d.valor);
                        comunesNormPorDepto[d.id] = this.round2((comunesNormPorDepto[d.id] || 0) + d.valor);
                    });
                }
            }
        } catch(e) { luzComunCosto = 0; }

        const rows = propietarios.map(p => {
            const comunes = this.round2(comunesPorDepto[p.id] || 0);
            const comunesNormales = this.round2(comunesNormPorDepto[p.id] || 0);
            const extraordinarias = this.round2(extrasPorDepto[p.id] || 0);
            const aguaRes = this.calcAguaDepto ? this.calcAguaDepto(mes, p.departamento) : null;
            const gasRes = this.calcGasDepto ? this.calcGasDepto(mes, p.departamento) : null;
            const luzRes = (usaLuzFactura && this.calcLuzDepto) ? this.calcLuzDepto(mes, p.departamento) : null;
            const agua = this.round2(aguaRes ? (Number(aguaRes.total) || 0) : 0);
            const gas = this.round2(gasRes ? (Number(gasRes.total) || 0) : 0);
            const luz = this.round2(luzRes ? (Number(luzRes.total) || 0) : 0);
            const consumos = this.round2(agua + gas + luz); // individuales por departamento
            const cargo = this.round2(comunes + consumos); // total a pagar del periodo
            const pagado = this.round2(pagos.filter(pg => pg.propietarioId == p.id).reduce((s, pg) => s + (Number(pg.monto) || 0), 0));
            const saldo = this.round2(cargo - pagado);
            let estado = 'Al día', estadoClass = 'ok';
            if (cargo <= 0.01 && pagado <= 0.01) {
                estado = 'Sin cargo';
                estadoClass = 'neutral';
            } else if (cargo <= 0.01 && pagado > 0.01) {
                estado = 'A favor';
                estadoClass = 'ok';
            } else if (saldo > 0.01) {
                if (pagado > 0.01) { estado = 'Parcial'; estadoClass = 'parcial'; }
                else { estado = 'Pendiente'; estadoClass = 'debe'; }
            } else if (saldo < -0.01) {
                estado = 'A favor';
                estadoClass = 'ok';
            } else {
                estado = 'Al día';
                estadoClass = 'ok';
            }
            return {
                ...p,
                id: p.id,
                depto: p.departamento || '-',
                m2: Number(p.m2) || 0,
                coef: Number(p.coeficiente) || 0,
                comunes,
                comunesNormales,
                extraordinarias,
                agua,
                gas,
                luz,
                consumos,
                cargo,
                total: cargo,
                pagado,
                saldo,
                estado,
                estadoClass
            };
        });

        const sumComunes = this.round2(rows.reduce((s,r)=>s+(r.comunes||0),0));
        const sumConsumosInd = this.round2(rows.reduce((s,r)=>s+(r.consumos||0),0));
        const sumAgua = this.round2(rows.reduce((s,r)=>s+(r.agua||0),0));
        const sumGas = this.round2(rows.reduce((s,r)=>s+(r.gas||0),0));
        const sumLuz = this.round2(rows.reduce((s,r)=>s+(r.luz||0),0));
        const sumCargo = this.round2(rows.reduce((s,r)=>s+(r.cargo||0),0));
        const sumPagado = this.round2(rows.reduce((s,r)=>s+(r.pagado||0),0));
        const sumPendiente = this.round2(rows.reduce((s,r)=>s + (r.saldo>0.01 ? r.saldo : 0), 0));
        const alDia = rows.filter(r => (r.cargo > 0.01 ? r.saldo <= 0.01 : r.pagado <= 0.01)).length;
        const conCargo = rows.filter(r => r.cargo > 0.01).length;

        let totalAgua = 0, totalGas = 0, totalLuz = 0;
        try { totalAgua = this.calcAguaTotal ? (this.calcAguaTotal(mes) || 0) : 0; } catch(e){}
        try { totalGas = this.calcGasTotal ? (this.calcGasTotal(mes) || 0) : 0; } catch(e){}
        try {
            if (usaLuzFactura && this.calcLuzTotal) {
                totalLuz = this.calcLuzTotal(mes) || 0;
            } else {
                const gl = DB.getGastoLuz ? DB.getGastoLuz(mes) : null;
                const lz = DB.getLuz ? DB.getLuz(mes) : null;
                totalLuz = parseFloat(gl?.monto != null ? gl.monto : (lz?.monto != null ? lz.monto : 0)) || 0;
            }
        } catch(e){}
        // En modelo con factura de luz, los consumos individuales de luz están en filas y áreas comunes en comunes (luzComunCosto)
        const totalConsumosMes = this.round2(totalAgua + totalGas + (usaLuzFactura ? sumLuz : totalLuz));
        const totalGastosMes = this.round2((this.calcTotalGastosMes ? this.calcTotalGastosMes(mes) : 0) || 0);

        // Punto 5: Gastos del Periodo vs Cuotas Generadas (deben cuadrar al 100%)
        totalGastosPeriodo = this.round2(totalGastosPeriodo);
        const totalCuotasGeneradas = this.round2(sumComunes);
        const _diffGC = this.round2(totalGastosPeriodo - totalCuotasGeneradas);
        const cuadreGastosCuotas = Math.abs(_diffGC) < 0.01;
        // costo de agua/luz de áreas comunes prorrateado (si aplica)
        let aguaComun = 0, luzComun = 0;
        try {
            const modalidadAgua = this.getAguaModalidad ? this.getAguaModalidad() : 'medidor';
            const infoAgua = this.getAguaFacturaInfo ? this.getAguaFacturaInfo(mes) : null;
            if (modalidadAgua === 'medidor' && infoAgua) aguaComun = this.round2(Number(infoAgua.costoComun) || 0);
        } catch(e) {}
        try {
            if (usaLuzFactura) {
                const modalidadLuz = this.getLuzModalidad ? this.getLuzModalidad() : 'medidor';
                const infoLuz = this.getLuzFacturaInfo ? this.getLuzFacturaInfo(mes) : null;
                if (modalidadLuz === 'medidor' && infoLuz) luzComun = this.round2(Number(infoLuz.costoComun) || 0);
            }
        } catch(e) {}

        return {
            mes,
            rows,
            totals: {
                coef: this.round2(rows.reduce((s,r)=>s+r.coef,0)),
                m2: this.round2(rows.reduce((s,r)=>s+r.m2,0)),
                comunes: sumComunes,
                agua: sumAgua,
                gas: sumGas,
                luz: this.round2(usaLuzFactura ? sumLuz : totalLuz),
                consumosInd: sumConsumosInd,
                consumosMes: totalConsumosMes,
                aguaComun,
                luzComun,
                cargo: sumCargo,
                pagado: sumPagado,
                pendiente: sumPendiente,
                gastosMes: totalGastosMes,
                totalGastosPeriodo,
                totalCuotasGeneradas,
                cuadreGastosCuotas,
                alDia,
                conCargo,
                departamentos: rows.length
            }
        };
    },

    calcCargoPropietarioMes(mes, propietarioId) {
        const calc = this.calcMes(mes);
        return calc.rows.find(r => r.id == propietarioId) || null;
    },

// === Estado de Cuenta ===

    calcEstadoCuenta(propietarioId) {
        const propietario = DB.getPropietario(propietarioId);
        if (!propietario) return null;
        const data = DB.getData();
        const topeMes = DB.getMesActual() || this.getCurrentMes();

        const meses = new Set();
        (data.gastos || []).forEach(g => { if (g.mes) meses.add(g.mes); });
        (data.pagos || []).forEach(p => { if (p.mes) meses.add(p.mes); });
        Object.keys(data.gas || {}).forEach(m => meses.add(m));
        Object.keys(data.agua || {}).forEach(m => meses.add(m));
        Object.keys(data.aguaFacturas || {}).forEach(m => meses.add(m));
        Object.keys(data.luz || {}).forEach(m => meses.add(m));
        Object.keys(data.luzFacturas || {}).forEach(m => meses.add(m));
        Object.keys(data.luzFecha || {}).forEach(m => meses.add(m));
        Object.keys(data.aguaFecha || {}).forEach(m => meses.add(m));
        Object.keys(data.cajaChica || {}).forEach(m => meses.add(m));

        const filas = [...meses]
            .filter(m => m && m <= topeMes)
            .sort()
            .reverse()
            .map(mes => {
                const calc = this.calcMes ? this.calcMes(mes) : null;
                const row = calc ? calc.rows.find(r => r.id == propietarioId) : null;
                if (row) {
                    const cuotaFija = Number(row.comunesNormales || 0);
                    const extraordinarias = Number(row.extraordinarias || 0);
                    const gasMonto = Number(row.gas || 0);
                    const aguaMonto = Number(row.agua || 0);
                    const luzMonto = Number(row.luz || 0);
                    const cargo = Number(row.cargo || 0);
                    const pagado = Number(row.pagado || 0);
                    return { mes, cuotaFija, cuota: cuotaFija, extraordinarias, gas: gasMonto, agua: aguaMonto, luz: luzMonto, cargo, pagado, saldo: cargo - pagado, acumulado: 0 };
                }
                // fallback sin datos de cálculo
                const pagosMes = (data.pagos || []).filter(p => p.mes === mes && p.propietarioId == propietarioId).reduce((s,p)=>s+(Number(p.monto)||0),0);
                return { mes, cuotaFija: 0, cuota: 0, extraordinarias: 0, gas: 0, agua: 0, luz: 0, cargo: 0, pagado: pagosMes, saldo: -pagosMes, acumulado: 0 };
            });

        let acum = 0;
        for (let i = filas.length - 1; i >= 0; i--) {
            acum += filas[i].saldo;
            filas[i].acumulado = acum;
        }

        return {
            propietario,
            filas,
            totalAcumulado: acum,
            deudaTotal: filas.reduce((s, f) => s + (f.saldo > 0.01 ? f.saldo : 0), 0),
            mesesAdeudados: filas.filter(f => f.saldo > 0.01).map(f => f.mes)
        };
    },

    simplificarDeudas() {
        const balance = this.calcBalance();
        const deudores = balance.filter(b => b.balance < -0.01).map(b => ({ ...b, balance: Math.abs(b.balance) }));
        const acreedores = balance.filter(b => b.balance > 0.01);

        deudores.sort((a, b) => b.balance - a.balance);
        acreedores.sort((a, b) => b.balance - a.balance);

        const transferencias = [];
        let i = 0, j = 0;

        while (i < deudores.length && j < acreedores.length) {
            const monto = Math.min(deudores[i].balance, acreedores[j].balance);
            if (monto > 0.01) {
                transferencias.push({
                    de: deudores[i].nombre,
                    deId: deudores[i].id,
                    para: acreedores[j].nombre,
                    paraId: acreedores[j].id,
                    monto
                });
            }
            deudores[i].balance -= monto;
            acreedores[j].balance -= monto;
            if (deudores[i].balance < 0.01) i++;
            if (acreedores[j].balance < 0.01) j++;
        }

        return transferencias;
    },

    getMesesConDatos() {
        const data = DB.getData();
        const meses = new Set();
        data.gastos.forEach(g => { if (g.mes) meses.add(g.mes); });
        Object.keys(data.gas || {}).forEach(m => meses.add(m));
        Object.keys(data.agua || {}).forEach(m => meses.add(m));
        Object.keys(data.aguaFacturas || {}).forEach(m => meses.add(m));
        Object.keys(data.luz || {}).forEach(m => meses.add(m));
        Object.keys(data.luzFacturas || {}).forEach(m => meses.add(m));
        Object.keys(data.luzFecha || {}).forEach(m => meses.add(m));
        Object.keys(data.cajaChica || {}).forEach(m => meses.add(m));
        return [...meses].sort().reverse();
    },

    formatFecha(fecha) {
        if (!fecha || typeof fecha !== 'string') return '';
        const [y, m, d] = fecha.split('-');
        if (!y || !m || !d) return fecha;
        return `${d}/${m}`;
    },

    categoriaLabel(cat) {
        return CATEGORIAS[cat] ? CATEGORIAS[cat].label : cat;
    },

    categoriaIcon(cat) {
        return CATEGORIAS[cat] ? CATEGORIAS[cat].icon : '';
    },

    frecuenciaLabel(freq) {
        return FRECUENCIAS[freq] ? FRECUENCIAS[freq].label : freq;
    },

    // === Gas ===
    calcGasSubtotal(mes, depto) {
        const gasData = DB.getGas(mes);
        const deptoData = gasData[depto];
        if (!deptoData || deptoData.lecturaIni === undefined || deptoData.lecturaFin === undefined) return null;
        const consumo = Math.max(0, deptoData.lecturaFin - deptoData.lecturaIni);
        const params = DB.getGasParams();
        const precioKg = params.precioBalon / params.kgBalon;
        const subtotal = consumo * params.kgM3 * precioKg;
        return { consumo, subtotal };
    },

    calcGasMontoFijo(mes) {
        const params = DB.getGasParams();
        const totalBalones = (params.nBalones || 3) * params.precioBalon;
        const propietarios = this._sortDeptos(DB.getPropietarios());
        let sumaSubtotales = 0;
        let conLectura = 0;
        propietarios.forEach(p => {
            const s = this.calcGasSubtotal(mes, p.departamento);
            if (s) { sumaSubtotales += s.subtotal; conLectura++; }
        });
        if (conLectura === 0) return 0;
        return Math.max(0, (totalBalones - sumaSubtotales) / conLectura);
    },

    calcGasDepto(mes, depto) {
        const s = this.calcGasSubtotal(mes, depto);
        if (!s) return null;
        const montoFijo = this.calcGasMontoFijo(mes);
        const total = s.subtotal + montoFijo;
        return { consumo: s.consumo, subtotal: s.subtotal, montoFijo, total };
    },

    calcGasTotal(mes) {
        const propietarios = this._sortDeptos(DB.getPropietarios());
        let total = 0;
        propietarios.forEach(p => {
            const r = this.calcGasDepto(mes, p.departamento);
            if (r) total += r.total;
        });
        return total;
    },

    // === Agua (modalidad configurable: medidor m³ por defecto, coeficiente m², ocupantes/cápita) ===
    getAguaModalidad() {
        try { return (DB.getConfig && DB.getConfig().aguaModalidad) || 'medidor'; } catch(e) { return 'medidor'; }
    },

    _calcTarifaProgresiva(m3, tramos) {
        let total = 0;
        let restante = m3;
        let limiteAnt = 0;
        for (const tramo of (tramos || [])) {
            const capacidad = (tramo.hasta === null || tramo.hasta === undefined || tramo.hasta === Infinity)
                ? Infinity
                : tramo.hasta - limiteAnt;
            const uso = Math.min(restante, capacidad);
            total += uso * (Number(tramo.precio) || 0);
            restante -= uso;
            if (tramo.hasta !== null && tramo.hasta !== undefined && tramo.hasta !== Infinity && restante <= 0) break;
            limiteAnt = (tramo.hasta !== null && tramo.hasta !== undefined && tramo.hasta !== Infinity) ? tramo.hasta : Infinity;
        }
        return total;
    },

    calcAguaDraft(consumo) {
        const params = DB.getAguaParams ? DB.getAguaParams() : { tramosAgua: [], tramosAlcant: [] };
        return {
            aguaPotable: this._calcTarifaProgresiva(consumo, params.tramosAgua),
            alcantarillado: this._calcTarifaProgresiva(consumo, params.tramosAlcant)
        };
    },

    _sumConsumoAgua(mes) {
        const aguaData = DB.getAgua ? DB.getAgua(mes) : {};
        const propietarios = this._sortDeptos(DB.getPropietarios());
        let sum = 0;
        propietarios.forEach(p => {
            const d = aguaData[p.departamento];
            if (d && d.lecturaFin !== undefined && d.lecturaFin !== null && d.lecturaIni !== undefined && d.lecturaIni !== null) {
                const c = Math.max(0, (Number(d.lecturaFin) || 0) - (Number(d.lecturaIni) || 0));
                if (c > 0) sum += c;
            }
        });
        return sum;
    },

    getAguaFacturaInfo(mes) {
        const factura = DB.getFacturaAgua ? DB.getFacturaAgua(mes) : null;
        if (!factura) return null;
        const aguaPotable = Number(factura.aguaPotable) || 0;
        const alcantarillado = Number(factura.alcantarillado) || 0;
        const cargoFijo = Number(factura.cargoFijo) || 0;
        const igv = Number(factura.igv) || 0;
        const total = this.round2 ? this.round2(aguaPotable + alcantarillado + cargoFijo + igv) : (aguaPotable + alcantarillado + cargoFijo + igv);
        const consumoFactura = Math.max(0, Number(factura.consumo) || 0);
        const consumoDeptos = this._sumConsumoAgua(mes);
        const consumoComun = consumoFactura > 0 ? Math.max(0, this.round2 ? this.round2(consumoFactura - consumoDeptos) : (consumoFactura - consumoDeptos)) : 0;
        const baseConsumo = consumoFactura > 0 ? consumoFactura : (consumoDeptos > 0 ? consumoDeptos : 0);
        const costoDeptos = baseConsumo > 0 ? (this.round2 ? this.round2(total * (Math.min(consumoDeptos, baseConsumo) / baseConsumo)) : (total * (Math.min(consumoDeptos, baseConsumo) / baseConsumo))) : 0;
        const costoComun = this.round2 ? this.round2(total - costoDeptos) : (total - costoDeptos);
        return { factura, total, consumoFactura, consumoDeptos, consumoComun, costoDeptos, costoComun, baseConsumo };
    },

    _getAguaTotalFactura(mes) {
        const info = this.getAguaFacturaInfo(mes);
        return info ? info.total : 0;
    },

    calcAguaDepto(mes, depto) {
        const propietarios = this._sortDeptos(DB.getPropietarios());
        const prop = propietarios.find(p => String(p.departamento) === String(depto));
        if (!prop) return null;
        const aguaData = DB.getAgua ? DB.getAgua(mes) : {};
        const deptoData = aguaData[depto] || {};
        const tieneLectura = (deptoData.lecturaIni !== undefined && deptoData.lecturaIni !== null && deptoData.lecturaIni !== '') || (deptoData.lecturaFin !== undefined && deptoData.lecturaFin !== null && deptoData.lecturaFin !== '');
        const consumo = Math.max(0, (Number(deptoData.lecturaFin) || 0) - (Number(deptoData.lecturaIni) || 0));
        const modalidad = this.getAguaModalidad();
        const totalFactura = this._getAguaTotalFactura(mes);

        if (modalidad === 'medidor') {
            // Por defecto: consumo individual por medidor (m³). Si la factura indica consumo total, el costo se asigna por participación sobre ese total y la diferencia corresponde a áreas comunes.
            if (!tieneLectura || consumo <= 0) return null;
            if (totalFactura <= 0) return { consumo, share: 0, total: 0, modalidad };
            const info = this.getAguaFacturaInfo ? this.getAguaFacturaInfo(mes) : null;
            const baseConsumo = info && info.consumoFactura > 0 ? info.consumoFactura : (info ? info.consumoDeptos : this._sumConsumoAgua(mes));
            if (baseConsumo <= 0) return { consumo, share: 0, total: 0, modalidad };
            const share = consumo / baseConsumo;
            const total = this.round2 ? this.round2(totalFactura * share) : (totalFactura * share);
            return { consumo, share, totalFactura, total, modalidad, baseConsumoFactura: (info && info.consumoFactura) || 0, consumoComun: (info && info.consumoComun) || 0 };
        }

        // Modalidades de prorrateo del total de agua del periodo
        if (totalFactura <= 0) return (tieneLectura || consumo > 0) ? { consumo, share: 0, total: 0, modalidad } : null;
        let share = 0;
        if (modalidad === 'coeficiente') {
            const base = propietarios.reduce((s,p)=>s + (Number(p.coeficiente)||0), 0);
            share = base > 0 ? (Number(prop.coeficiente)||0) / base : 0;
        } else if (modalidad === 'ocupantes') {
            const base = propietarios.reduce((s,p)=>s + Math.max(0, parseInt(p.residentes,10)||0), 0);
            const occ = Math.max(0, parseInt(prop.residentes,10)||0);
            share = base > 0 ? occ / base : 0;
        }
        const total = this.round2 ? this.round2(totalFactura * share) : (totalFactura * share);
        // retornar consumo medido si existe (informativo), pero total según modalidad
        if (!tieneLectura && consumo <= 0) return { consumo: 0, share, totalFactura, total, modalidad };
        return { consumo, share, totalFactura, total, modalidad };
    },

    calcAguaTotal(mes) {
        const propietarios = this._sortDeptos(DB.getPropietarios());
        const modalidad = this.getAguaModalidad();
        // Para modalidades de prorrateo, el total corresponde al total de factura distribuido
        if (modalidad !== 'medidor') {
            const totalFactura = this._getAguaTotalFactura(mes);
            if (totalFactura > 0) return totalFactura;
        }
        // Medidor: total asignado a departamentos (el consumo/costo de áreas comunes se muestra aparte)
        let total = 0;
        propietarios.forEach(p => {
            const r = this.calcAguaDepto(mes, p.departamento);
            if (r) total += Number(r.total) || 0;
        });
        return this.round2 ? this.round2(total) : total;
    },

    // === Luz (modalidad configurable, similar a agua: medidor kWh por defecto, coeficiente m², ocupantes/cápita) ===
    getLuzModalidad() {
        try { return (DB.getConfig && DB.getConfig().luzModalidad) || this.getAguaModalidad(); } catch(e) { return this.getAguaModalidad ? this.getAguaModalidad() : 'medidor'; }
    },

    _sumConsumoLuz(mes) {
        const luzData = DB.getLuz ? DB.getLuz(mes) : {};
        const propietarios = this._sortDeptos(DB.getPropietarios());
        let sum = 0;
        propietarios.forEach(p => {
            const d = luzData[p.departamento];
            if (d && d.lecturaFin !== undefined && d.lecturaFin !== null && d.lecturaIni !== undefined && d.lecturaIni !== null) {
                const c = Math.max(0, (Number(d.lecturaFin) || 0) - (Number(d.lecturaIni) || 0));
                if (c > 0) sum += c;
            }
        });
        return sum;
    },

    getLuzFacturaInfo(mes) {
        const factura = DB.getFacturaLuz ? DB.getFacturaLuz(mes) : null;
        if (!factura) return null;
        const energia = Number(factura.energia) || 0;
        const alumbradoPublico = Number(factura.alumbradoPublico) || 0;
        const cargoFijo = Number(factura.cargoFijo) || 0;
        const igv = Number(factura.igv) || 0;
        const total = this.round2 ? this.round2(energia + alumbradoPublico + cargoFijo + igv) : (energia + alumbradoPublico + cargoFijo + igv);
        const consumoFactura = Math.max(0, Number(factura.consumo) || 0);
        const consumoDeptos = this._sumConsumoLuz(mes);
        const consumoComun = consumoFactura > 0 ? Math.max(0, this.round2 ? this.round2(consumoFactura - consumoDeptos) : (consumoFactura - consumoDeptos)) : 0;
        const baseConsumo = consumoFactura > 0 ? consumoFactura : (consumoDeptos > 0 ? consumoDeptos : 0);
        const costoDeptos = baseConsumo > 0 ? (this.round2 ? this.round2(total * (Math.min(consumoDeptos, baseConsumo) / baseConsumo)) : (total * (Math.min(consumoDeptos, baseConsumo) / baseConsumo))) : 0;
        const costoComun = this.round2 ? this.round2(total - costoDeptos) : (total - costoDeptos);
        return { factura, total, consumoFactura, consumoDeptos, consumoComun, costoDeptos, costoComun, baseConsumo };
    },

    _getLuzTotalFactura(mes) {
        const info = this.getLuzFacturaInfo(mes);
        return info ? info.total : 0;
    },

    calcLuzDepto(mes, depto) {
        const propietarios = this._sortDeptos(DB.getPropietarios());
        const prop = propietarios.find(p => String(p.departamento) === String(depto));
        if (!prop) return null;
        const luzData = DB.getLuz ? DB.getLuz(mes) : {};
        const deptoData = luzData[depto] || {};
        const tieneLectura = (deptoData.lecturaIni !== undefined && deptoData.lecturaIni !== null && deptoData.lecturaIni !== '') || (deptoData.lecturaFin !== undefined && deptoData.lecturaFin !== null && deptoData.lecturaFin !== '');
        const consumo = Math.max(0, (Number(deptoData.lecturaFin) || 0) - (Number(deptoData.lecturaIni) || 0));
        const modalidad = this.getLuzModalidad();
        const totalFactura = this._getLuzTotalFactura(mes);

        if (modalidad === 'medidor') {
            if (!tieneLectura || consumo <= 0) return null;
            if (totalFactura <= 0) return { consumo, share: 0, total: 0, modalidad };
            const info = this.getLuzFacturaInfo ? this.getLuzFacturaInfo(mes) : null;
            const baseConsumo = info && info.consumoFactura > 0 ? info.consumoFactura : (info ? info.consumoDeptos : this._sumConsumoLuz(mes));
            if (baseConsumo <= 0) return { consumo, share: 0, total: 0, modalidad };
            const share = consumo / baseConsumo;
            const total = this.round2 ? this.round2(totalFactura * share) : (totalFactura * share);
            return { consumo, share, totalFactura, total, modalidad, baseConsumoFactura: (info && info.consumoFactura) || 0, consumoComun: (info && info.consumoComun) || 0 };
        }

        if (totalFactura <= 0) return (tieneLectura || consumo > 0) ? { consumo, share: 0, total: 0, modalidad } : null;
        let share = 0;
        if (modalidad === 'coeficiente') {
            const base = propietarios.reduce((s,p)=>s + (Number(p.coeficiente)||0), 0);
            share = base > 0 ? (Number(prop.coeficiente)||0) / base : 0;
        } else if (modalidad === 'ocupantes') {
            const base = propietarios.reduce((s,p)=>s + Math.max(0, parseInt(p.residentes,10)||0), 0);
            const occ = Math.max(0, parseInt(prop.residentes,10)||0);
            share = base > 0 ? occ / base : 0;
        }
        const total = this.round2 ? this.round2(totalFactura * share) : (totalFactura * share);
        if (!tieneLectura && consumo <= 0) return { consumo: 0, share, totalFactura, total, modalidad };
        return { consumo, share, totalFactura, total, modalidad };
    },

    calcLuzTotal(mes) {
        const propietarios = this._sortDeptos(DB.getPropietarios());
        const modalidad = this.getLuzModalidad();
        if (modalidad !== 'medidor') {
            const totalFactura = this._getLuzTotalFactura(mes);
            if (totalFactura > 0) return totalFactura;
        }
        let total = 0;
        propietarios.forEach(p => {
            const r = this.calcLuzDepto(mes, p.departamento);
            if (r) total += Number(r.total) || 0;
        });
        return this.round2 ? this.round2(total) : total;
    }
};
