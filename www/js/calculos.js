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

    _calcGastoParaPropietario(gasto, propietario, totalCoef, numPropietarios) {
        const equiv = this.getGastoMensualEquivalente(gasto);
        if (gasto.frecuencia === 'extraordinario' && gasto.division === 'igualitario') {
            return numPropietarios > 0 ? equiv / numPropietarios : 0;
        }
        return totalCoef > 0 ? (equiv * propietario.coeficiente) / totalCoef : 0;
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
        gastos.forEach(g => {
            propietarios.forEach(p => {
                const val = this._calcGastoParaPropietario(g, p, totalCoef, propietarios.length);
                comunesPorDepto[p.id] += val;
                if (g.frecuencia === 'extraordinario') extrasPorDepto[p.id] += val; else comunesNormPorDepto[p.id] += val;
            });
        });

        const rows = propietarios.map(p => {
            const comunes = comunesPorDepto[p.id] || 0;
            const comunesNormales = comunesNormPorDepto[p.id] || 0;
            const extraordinarias = extrasPorDepto[p.id] || 0;
            const aguaRes = this.calcAguaDepto ? this.calcAguaDepto(mes, p.departamento) : null;
            const gasRes = this.calcGasDepto ? this.calcGasDepto(mes, p.departamento) : null;
            const agua = aguaRes ? (Number(aguaRes.total) || 0) : 0;
            const gas = gasRes ? (Number(gasRes.total) || 0) : 0;
            const consumos = agua + gas; // individuales por departamento
            const cargo = comunes + consumos; // total a pagar del mes
            const pagado = pagos.filter(pg => pg.propietarioId === p.id).reduce((s, pg) => s + (Number(pg.monto) || 0), 0);
            const saldo = cargo - pagado;
            let estado = 'Pagado', estadoClass = 'ok';
            if (saldo > 0.01) {
                if (pagado > 0.01) { estado = 'Parcial'; estadoClass = 'parcial'; }
                else { estado = 'Pendiente'; estadoClass = 'debe'; }
            } else if (saldo < -0.01) {
                estado = 'A favor'; estadoClass = 'ok';
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
                consumos,
                cargo,
                total: cargo,
                pagado,
                saldo,
                estado,
                estadoClass
            };
        });

        const sumComunes = rows.reduce((s,r)=>s+(r.comunes||0),0);
        const sumConsumosInd = rows.reduce((s,r)=>s+(r.consumos||0),0);
        const sumAgua = rows.reduce((s,r)=>s+(r.agua||0),0);
        const sumGas = rows.reduce((s,r)=>s+(r.gas||0),0);
        const sumCargo = rows.reduce((s,r)=>s+(r.cargo||0),0);
        const sumPagado = rows.reduce((s,r)=>s+(r.pagado||0),0);
        const sumPendiente = rows.reduce((s,r)=>s + (r.saldo>0.01 ? r.saldo : 0), 0);
        const alDia = rows.filter(r => r.saldo <= 0.01).length;

        let totalAgua = 0, totalGas = 0, totalLuz = 0;
        try { totalAgua = this.calcAguaTotal ? (this.calcAguaTotal(mes) || 0) : 0; } catch(e){}
        try { totalGas = this.calcGasTotal ? (this.calcGasTotal(mes) || 0) : 0; } catch(e){}
        try {
            const gl = DB.getGastoLuz ? DB.getGastoLuz(mes) : null;
            const lz = DB.getLuz ? DB.getLuz(mes) : null;
            totalLuz = parseFloat(gl?.monto != null ? gl.monto : (lz?.monto != null ? lz.monto : 0)) || 0;
        } catch(e){}
        const totalConsumosMes = totalAgua + totalGas + totalLuz;
        const totalGastosMes = (this.calcTotalGastosMes ? this.calcTotalGastosMes(mes) : 0) || 0;

        return {
            mes,
            rows,
            totals: {
                coef: rows.reduce((s,r)=>s+r.coef,0),
                m2: rows.reduce((s,r)=>s+r.m2,0),
                comunes: sumComunes,
                agua: sumAgua,
                gas: sumGas,
                consumosInd: sumConsumosInd,
                consumosMes: totalConsumosMes,
                luz: totalLuz,
                cargo: sumCargo,
                pagado: sumPagado,
                pendiente: sumPendiente,
                gastosMes: totalGastosMes,
                alDia,
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
                    const cargo = Number(row.cargo || 0);
                    const pagado = Number(row.pagado || 0);
                    return { mes, cuotaFija, cuota: cuotaFija, extraordinarias, gas: gasMonto, agua: aguaMonto, cargo, pagado, saldo: cargo - pagado, acumulado: 0 };
                }
                // fallback sin datos de cálculo
                const pagosMes = (data.pagos || []).filter(p => p.mes === mes && p.propietarioId == propietarioId).reduce((s,p)=>s+(Number(p.monto)||0),0);
                return { mes, cuotaFija: 0, cuota: 0, extraordinarias: 0, gas: 0, agua: 0, cargo: 0, pagado: pagosMes, saldo: -pagosMes, acumulado: 0 };
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

    // === Agua (factura del recibo repartida por consumo m³) ===
    _calcTarifaProgresiva(m3, tramos) {
        let total = 0;
        let restante = m3;
        let limiteAnt = 0;
        for (const tramo of tramos) {
            const capacidad = (tramo.hasta === null || tramo.hasta === undefined || tramo.hasta === Infinity)
                ? Infinity
                : tramo.hasta - limiteAnt;
            const uso = Math.min(restante, capacidad);
            total += uso * tramo.precio;
            restante -= uso;
            if (tramo.hasta !== null && tramo.hasta !== undefined && tramo.hasta !== Infinity && restante <= 0) break;
            limiteAnt = (tramo.hasta !== null && tramo.hasta !== undefined && tramo.hasta !== Infinity) ? tramo.hasta : Infinity;
        }
        return total;
    },

    calcAguaDraft(consumo) {
        const params = DB.getAguaParams();
        return {
            aguaPotable: this._calcTarifaProgresiva(consumo, params.tramosAgua),
            alcantarillado: this._calcTarifaProgresiva(consumo, params.tramosAlcant)
        };
    },

    _sumConsumoAgua(mes) {
        const aguaData = DB.getAgua(mes);
        const propietarios = this._sortDeptos(DB.getPropietarios());
        let sum = 0;
        propietarios.forEach(p => {
            const d = aguaData[p.departamento];
            if (d && d.lecturaFin !== undefined && d.lecturaFin !== null && d.lecturaIni !== undefined && d.lecturaIni !== null) {
                const c = Math.max(0, (d.lecturaFin || 0) - (d.lecturaIni || 0));
                if (c > 0) sum += c;
            }
        });
        return sum;
    },

    calcAguaDepto(mes, depto) {
        const aguaData = DB.getAgua(mes);
        const deptoData = aguaData[depto];
        if (!deptoData || (!deptoData.lecturaIni && !deptoData.lecturaFin)) return null;
        const consumo = Math.max(0, deptoData.lecturaFin - deptoData.lecturaIni);
        if (consumo <= 0) return null;
        const factura = DB.getFacturaAgua(mes);
        if (!factura) return null;
        const aguaPotable = factura.aguaPotable || 0;
        const alcantarillado = factura.alcantarillado || 0;
        const cargoFijo = factura.cargoFijo || 0;
        const igv = factura.igv || 0;
        const totalFactura = aguaPotable + alcantarillado + cargoFijo + igv;
        if (totalFactura <= 0) return null;
        const sumM3 = this._sumConsumoAgua(mes);
        if (sumM3 <= 0) return null;
        const share = consumo / sumM3;
        return {
            consumo,
            share,
            totalFactura,
            aguaPotable: aguaPotable * share,
            alcantarillado: alcantarillado * share,
            cargoFijo: cargoFijo * share,
            igv: igv * share,
            total: totalFactura * share
        };
    },

    calcAguaTotal(mes) {
        const factura = DB.getFacturaAgua(mes);
        if (!factura) return 0;
        const propietarios = this._sortDeptos(DB.getPropietarios());
        let total = 0;
        propietarios.forEach(p => {
            const r = this.calcAguaDepto(mes, p.departamento);
            if (r) total += r.total;
        });
        return total;
    }
};
