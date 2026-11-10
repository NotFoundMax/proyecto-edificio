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
        return DB.getPropietarios().reduce((sum, p) => sum + (p.cuotaMensual || 0), 0);
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
        const propietarios = DB.getPropietarios();
        const totalCoeficientes = propietarios.reduce((sum, p) => sum + p.coeficiente, 0);
        return gastos.reduce((sum, g) => {
            return sum + this._calcGastoParaPropietario(g, propietario, totalCoeficientes, propietarios.length);
        }, 0);
    },

    calcResumenPropietarios(mes) {
        const propietarios = DB.getPropietarios();
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
        const propietarios = DB.getPropietarios();
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

    // === Estado de Cuenta ===
    calcEstadoCuenta(propietarioId) {
        const propietario = DB.getPropietario(propietarioId);
        if (!propietario) return null;
        const data = DB.getData();
        const propietarios = DB.getPropietarios();
        const totalCoef = propietarios.reduce((s, p) => s + p.coeficiente, 0);
        const topeMes = DB.getMesActual() || this.getCurrentMes();

        const meses = new Set();
        data.gastos.forEach(g => { if (g.mes) meses.add(g.mes); });
        data.pagos.forEach(p => { if (p.mes) meses.add(p.mes); });
        Object.keys(data.gas || {}).forEach(m => meses.add(m));
        Object.keys(data.agua || {}).forEach(m => meses.add(m));
        Object.keys(data.aguaFacturas || {}).forEach(m => meses.add(m));
        Object.keys(data.cajaChica || {}).forEach(m => meses.add(m));

        const filas = [...meses]
            .filter(m => m <= topeMes)
            .sort()
            .reverse()
            .map(mes => {
            const gastosExtra = DB.getGastos({ mes }).filter(g => g.frecuencia === 'extraordinario');
            const extraordinarias = gastosExtra.reduce((sum, g) => {
                return sum + this._calcGastoParaPropietario(g, propietario, totalCoef, propietarios.length);
            }, 0);
            const gas = this.calcGasDepto(mes, propietario.departamento);
            const gasMonto = gas ? gas.total : 0;
            const agua = this.calcAguaDepto(mes, propietario.departamento);
            const aguaMonto = agua ? agua.total : 0;
            const cuotaFija = propietario.cuotaMensual || 0;
            const cargo = cuotaFija + extraordinarias + gasMonto + aguaMonto;
            const pagado = data.pagos
                .filter(p => p.mes === mes && p.propietarioId === propietarioId)
                .reduce((s, p) => s + p.monto, 0);
            return { mes, cuotaFija, extraordinarias, gas: gasMonto, agua: aguaMonto, cargo, pagado, saldo: cargo - pagado, acumulado: 0 };
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
        const propietarios = DB.getPropietarios();
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
        const propietarios = DB.getPropietarios();
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
        const propietarios = DB.getPropietarios();
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
        const propietarios = DB.getPropietarios();
        let total = 0;
        propietarios.forEach(p => {
            const r = this.calcAguaDepto(mes, p.departamento);
            if (r) total += r.total;
        });
        return total;
    }
};
