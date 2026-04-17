// ─── CONFIGURAÇÃO ───────────────────────────────────────────────────────────
const BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSJq1BdeNlo6gvM1vBhtgD88MRevuRrODf2NmVESwH5CMQ6VBkuZMUaNEr8xCoHeJlmnlsJaDV_Cj9L/pub';

const URL_VERBAS     = BASE_URL + '?gid=1303157015&single=true&output=csv';
const URL_SERVIDORES = BASE_URL + '?gid=1533392322&single=true&output=csv';
const URL_CARGOS     = BASE_URL + '?gid=1823673227&single=true&output=csv';
const URL_ESTRUTURAS = BASE_URL + '?gid=46958645&single=true&output=csv';

// ─── REGRAS DE NEGÓCIO ──────────────────────────────────────────────────────
const TETO_VEREADOR  = 92998.45;
const TOLERANCIA     = 0.13;
const MAX_SERVIDORES = 9;

// Lista exata de lotações especiais com estrutura fixa definida por lei.
// TUDO que não estiver aqui e não começar com "Bloco" ou "Liderança" = Gabinete de Vereador.
const LOTACOES_ESPECIAIS = {
    'GABINETE DA PRESIDÊNCIA':         ['CC-1', 'CC-5', 'CC-6', 'CC-7'],
    'GABINETE DA 1ª VICE-PRESIDÊNCIA': ['CC-4', 'CC-6'],
    'GABINETE DA 2ª VICE-PRESIDÊNCIA': ['CC-4', 'CC-7'],
    'GABINETE DA 1ª SECRETARIA':       ['CC-3', 'CC-6', 'CC-7'],
    'GABINETE DA 2ª SECRETARIA':       ['CC-4', 'CC-6', 'CC-7'],
    'GABINETE DA 3ª SECRETARIA':       ['CC-5', 'CC-7'],
    'GABINETE DA 4ª SECRETARIA':       ['CC-5', 'CC-7'],
};

// ─── ESTADO GLOBAL ──────────────────────────────────────────────────────────
let dadosVerbas     = [];
let dadosServidores = [];
let tabelaCargos    = {};  // { 'CC-1': 12000.00, ... }
let dadosEstruturas = {};  // { 'Gabinete X': ['CC-1','CC-3','CC-6'], ... }

// ─── INICIALIZAÇÃO ──────────────────────────────────────────────────────────
function iniciar() {
    Promise.all([
        carregarCSV(URL_VERBAS),
        carregarCSV(URL_SERVIDORES),
        carregarCSV(URL_CARGOS),
        carregarCSV(URL_ESTRUTURAS),
    ])
    .then(([verbas, servidores, cargos, estruturas]) => {
        dadosVerbas     = verbas;
        dadosServidores = servidores;
        tabelaCargos    = construirTabelaCargos(cargos);
        dadosEstruturas = construirEstruturas(estruturas);
        preencherFiltros();
        setStatus('ok', 'Dados carregados');
    })
    .catch(err => {
        console.error(err);
        setStatus('erro', 'Erro ao carregar dados');
    });
}

function carregarCSV(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: r => resolve(r.data),
            error:    e => reject(e),
        });
    });
}

function construirTabelaCargos(linhas) {
    const tabela = {};
    linhas.forEach(l => {
        const cargo   = (l['Cargo'] || '').trim();
        const salario = parseMoeda(l['Salário'] || l['Salario'] || '0');
        if (cargo) tabela[cargo] = salario;
    });
    return tabela;
}

// Aba estruturas: colunas Gabinete | Cargo
// Uma linha por cargo da estrutura (com repetições para mesmo CC)
function construirEstruturas(linhas) {
    const estruturas = {};
    linhas.forEach(l => {
        const gab   = (l['Gabinete'] || '').trim();
        const cargo = (l['Cargo'] || '').trim();
        if (!gab || !cargo) return;
        if (!estruturas[gab]) estruturas[gab] = [];
        estruturas[gab].push(cargo);
    });
    return estruturas;
}

// ─── CLASSIFICAÇÃO ──────────────────────────────────────────────────────────
// Retorna 'mesa_diretora', 'bloco' ou 'vereador'
function classificarTipo(gabinete) {
    const g = gabinete.trim().toUpperCase();
    // Verifica lista exata de lotações especiais (case-insensitive)
    for (const nome of Object.keys(LOTACOES_ESPECIAIS)) {
        if (g === nome.toUpperCase()) return 'mesa_diretora';
    }
    // Blocos e lideranças: nome contém essas palavras
    if (/\bbloco\b/i.test(g) || /\blideran/i.test(g)) return 'bloco';
    // Todo o resto = gabinete de vereador
    return 'vereador';
}

// ─── FILTROS ────────────────────────────────────────────────────────────────
function preencherFiltros() {
    const mesSelect = document.getElementById('mesSelect');
    const gabSelect = document.getElementById('gabineteSelect');

    const mesesSet = new Set();
    const gabSet   = new Set();

    dadosVerbas.forEach(l => {
        if (l['Mês'])      mesesSet.add(l['Mês'].trim());
        if (l['Gabinete']) gabSet.add(l['Gabinete'].trim());
    });

    // Ordena meses cronologicamente MM/AAAA
    const mesesOrdenados = [...mesesSet].sort((a, b) => {
        const [ma, aa] = a.split('/').map(Number);
        const [mb, ab] = b.split('/').map(Number);
        return aa !== ab ? aa - ab : ma - mb;
    });

    const gabsOrdenados = [...gabSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    mesSelect.innerHTML = '<option value="">Selecione o mês...</option>';
    gabSelect.innerHTML = '<option value="">Selecione a lotação...</option>';

    mesesOrdenados.forEach(m => mesSelect.innerHTML += `<option value="${m}">${m}</option>`);
    gabsOrdenados.forEach(g  => gabSelect.innerHTML += `<option value="${g}">${g}</option>`);

    mesSelect.addEventListener('change', atualizarPainel);
    gabSelect.addEventListener('change', atualizarPainel);
}

// ─── ATUALIZAÇÃO PRINCIPAL ──────────────────────────────────────────────────
function atualizarPainel() {
    const mes = document.getElementById('mesSelect').value.trim();
    const gab = document.getElementById('gabineteSelect').value.trim();

    ocultarTudo();
    if (!mes || !gab) return;

    const { inicio, fim } = intervaloMes(mes);

    const verbaMes = dadosVerbas.find(
        l => l['Mês']?.trim() === mes && l['Gabinete']?.trim() === gab
    ) || {};

    // Filtra servidores ativos no mês via datas
    const servidoresMes = dadosServidores
        .filter(l => (l['Gabinete'] || '').trim() === gab)
        .map(l => {
            const admissao       = parseData(l['Admissão']   || l['Admissao']   || '');
            const exoneracao     = parseData(l['Exoneração'] || l['Exoneracao'] || '');
            const ativo          = estaAtivo(admissao, exoneracao, inicio, fim);
            const exoneradoNoMes = !!(exoneracao && exoneracao >= inicio && exoneracao <= fim);
            return { ...l, admissao, exoneracao, ativo, exoneradoNoMes };
        })
        .filter(l => l.ativo);

    const tipo = classificarTipo(gab);
    atualizarTopbarBadges(mes, tipo);

    if (tipo === 'vereador') {
        renderizarVereador(gab, verbaMes, servidoresMes);
    } else {
        renderizarEspecial(gab, tipo, verbaMes, servidoresMes);
    }
}

// ─── TOPBAR BADGES ──────────────────────────────────────────────────────────
function atualizarTopbarBadges(mes, tipo) {
    let tipoBadge = '';
    if (tipo === 'vereador')       tipoBadge = `<span class="badge badge-tipo-vereador">Gabinete de Vereador</span>`;
    else if (tipo === 'mesa_diretora') tipoBadge = `<span class="badge badge-tipo-especial">Mesa Diretora</span>`;
    else                           tipoBadge = `<span class="badge badge-tipo-especial">Bloco / Liderança</span>`;
    document.getElementById('topbarBadges').innerHTML =
        `<span class="badge badge-mes">${mes}</span>${tipoBadge}`;
}

// ─── PAINEL VEREADOR ────────────────────────────────────────────────────────
function renderizarVereador(gab, verbaMes, servidores) {
    document.getElementById('painelVereador').classList.remove('escondido');

    const responsavel = (verbaMes['Responsável'] || verbaMes['Responsavel'] || '').trim();

    // Verba utilizada = soma dos salários de todos ativos no mês (incluindo exonerados no mês)
    let verbaUtil = 0;
    servidores.forEach(s => {
        const cargo = (s['Cargo'] || '').trim();
        verbaUtil += tabelaCargos[cargo] || 0;
    });

    const saldo    = TETO_VEREADOR - verbaUtil;
    const pct      = TETO_VEREADOR > 0 ? Math.min((verbaUtil / TETO_VEREADOR) * 100, 100) : 0;
    const nServs   = servidores.filter(s => (s['Nome do Servidor'] || '').trim()).length;
    const vagasLiv = MAX_SERVIDORES - nServs;

    document.getElementById('vVerbaTotal').textContent    = moeda(TETO_VEREADOR);
    document.getElementById('vVerbaUtil').textContent     = moeda(verbaUtil);
    document.getElementById('vSaldo').textContent         = moeda(Math.abs(saldo));
    document.getElementById('vServidores').textContent    = `${nServs} / ${MAX_SERVIDORES}`;
    document.getElementById('vServidoresSub').textContent = vagasLiv > 0 ? `${vagasLiv} vaga(s) disponível` : 'sem vagas disponíveis';
    document.getElementById('vVerbaUtilSub').textContent  = responsavel ? `Resp.: ${responsavel}` : 'soma dos salários';

    const cardSaldo = document.getElementById('vSaldo').closest('.card');
    cardSaldo.classList.remove('card-saldo-negativo');
    if (saldo < 0) {
        cardSaldo.classList.add('card-saldo-negativo');
        document.getElementById('vSaldoSub').textContent = 'acima do teto';
    } else {
        document.getElementById('vSaldoSub').textContent = 'disponível no teto';
    }

    // Barra de progresso
    const fill  = document.getElementById('vProgressoFill');
    const pctEl = document.getElementById('vProgressoPct');
    fill.style.width  = pct.toFixed(1) + '%';
    pctEl.textContent = pct.toFixed(1) + '%';
    fill.classList.remove('aviso', 'perigo');
    if (pct >= 100)     fill.classList.add('perigo');
    else if (pct >= 85) fill.classList.add('aviso');

    // Alertas
    const alertas = [];
    const temCC1  = servidores.some(s => (s['Cargo'] || '').trim() === 'CC-1' && !s.exoneradoNoMes);
    if (!temCC1) alertas.push({ tipo: 'erro', msg: 'CC-1 (Chefe de Gabinete) não está lotado. Este cargo é obrigatório.' });
    if (nServs > MAX_SERVIDORES) alertas.push({ tipo: 'erro', msg: `O gabinete possui ${nServs} servidores, acima do limite de ${MAX_SERVIDORES}.` });
    if (verbaUtil > TETO_VEREADOR + TOLERANCIA) {
        alertas.push({ tipo: 'erro', msg: `Verba utilizada (${moeda(verbaUtil)}) excede o teto legal de ${moeda(TETO_VEREADOR)}.` });
    } else if (verbaUtil > TETO_VEREADOR) {
        alertas.push({ tipo: 'aviso', msg: 'Verba dentro da margem de tolerância de R$ 0,13.' });
    }
    const exoneradosNoMes = servidores.filter(s => s.exoneradoNoMes);
    if (exoneradosNoMes.length > 0) {
        const nomes = exoneradosNoMes.map(s => (s['Nome do Servidor'] || '').trim()).join(', ');
        alertas.push({ tipo: 'aviso', msg: `Exonerado(s) neste mês: ${nomes}.` });
    }
    if (alertas.length === 0) alertas.push({ tipo: 'ok', msg: 'Gabinete em conformidade com as regras legais.' });
    renderizarAlertas('alertasVereador', alertas);

    // ── Estrutura do gabinete ──
    const estrutura = dadosEstruturas[gab] || [];
    const resumoEl  = document.getElementById('vEstruturaResumo');

    if (estrutura.length === 0) {
        document.getElementById('gradeEstrutura').innerHTML =
            `<p style="font-size:14px;color:var(--muted);font-style:italic">Estrutura não cadastrada para este gabinete.</p>`;
        resumoEl.textContent = '';
    } else {
        // Conta cargos ocupados na estrutura (excluindo exonerados no mês)
        const cargosAtivos = servidores
            .filter(s => !s.exoneradoNoMes)
            .map(s => (s['Cargo'] || '').trim());

        // Percorre a estrutura marcando cada slot como ocupado ou livre
        // Permite repetição de CCs (ex: dois CC-3)
        const estruturaTrackeada = estrutura.map(cc => {
            const idx = cargosAtivos.indexOf(cc);
            if (idx !== -1) {
                cargosAtivos.splice(idx, 1); // consome o cargo para não reusar
                const srv = servidores.find(s =>
                    !s.exoneradoNoMes && (s['Cargo'] || '').trim() === cc
                );
                return { cc, ocupado: true, nome: (srv?.['Nome do Servidor'] || '').trim() };
            }
            return { cc, ocupado: false, nome: '' };
        });

        const totalVagas  = estruturaTrackeada.length;
        const vagasOcup   = estruturaTrackeada.filter(s => s.ocupado).length;
        const vagasLivres = totalVagas - vagasOcup;

        resumoEl.textContent = vagasLivres > 0
            ? `${vagasLivres} vaga(s) livre(s) de ${totalVagas}`
            : `${totalVagas} de ${totalVagas} preenchidos`;

        const grade = document.getElementById('gradeEstrutura');
        grade.innerHTML = '';
        estruturaTrackeada.forEach(slot => {
            if (slot.ocupado) {
                grade.innerHTML += `
                    <div class="cargo-slot cargo-slot-ocupado">
                        <span class="cargo-slot-cc">${slot.cc}</span>
                        <span class="cargo-slot-nome">${slot.nome}</span>
                        <span class="cargo-slot-status">● Ocupado</span>
                    </div>`;
            } else {
                grade.innerHTML += `
                    <div class="cargo-slot cargo-slot-livre">
                        <span class="cargo-slot-cc">${slot.cc}</span>
                        <span class="cargo-slot-nome">Vaga disponível</span>
                        <span class="cargo-slot-status">○ Livre</span>
                    </div>`;
            }
        });
    }

    // ── Tabela servidores ──
    const tbody = document.getElementById('corpoTabelaVereador');
    const tfoot = document.getElementById('rodapeTabelaVereador');
    tbody.innerHTML = '';

    servidores.forEach(s => {
        const nome       = (s['Nome do Servidor'] || '').trim();
        const cargo      = (s['Cargo'] || '').trim();
        const matricula  = (s['Matrícula'] || s['Matricula'] || '').trim();
        const sal        = tabelaCargos[cargo] || 0;
        const admStr     = s.admissao   ? formatarData(s.admissao)   : '—';
        const exoStr     = s.exoneracao ? formatarData(s.exoneracao) : '—';
        if (!nome) return;

        const exoTag  = s.exoneradoNoMes
            ? `<span class="tag-exonerado">Exonerado</span>`
            : '';
        tbody.innerHTML += `
            <tr class="${s.exoneradoNoMes ? 'tr-exonerado' : ''}">
                <td class="col-matricula">${matricula || '—'}</td>
                <td>${nome}${exoTag}</td>
                <td>${cargo || '—'}</td>
                <td class="col-salario">${sal > 0 ? moeda(sal) : '—'}</td>
                <td class="col-data">${admStr}</td>
                <td class="col-data">${exoStr}</td>
            </tr>`;
    });

    tfoot.innerHTML = `
        <tr>
            <td colspan="3">Total</td>
            <td class="col-salario col-salario-total">${moeda(verbaUtil)}</td>
            <td colspan="2"></td>
        </tr>`;
}

// ─── PAINEL ESPECIAL ────────────────────────────────────────────────────────
function renderizarEspecial(gab, tipo, verbaMes, servidores) {
    document.getElementById('painelEspecial').classList.remove('escondido');

    const responsavel = (verbaMes['Responsável'] || verbaMes['Responsavel'] || '').trim();
    const elResp = document.getElementById('eResponsavel');
    elResp.textContent   = responsavel || 'Responsável não informado';
    elResp.style.opacity = responsavel ? '1' : '0.5';

    // Estrutura esperada
    let estrutura = [];
    if (tipo === 'mesa_diretora') {
        // Busca nome original (case-insensitive) na tabela LOTACOES_ESPECIAIS
        const chave = Object.keys(LOTACOES_ESPECIAIS).find(
            k => k.toUpperCase() === gab.trim().toUpperCase()
        );
        estrutura = chave ? LOTACOES_ESPECIAIS[chave] : [];
    } else {
        estrutura = ['CC-8'];
    }

    // Mapeia cargos — prefere servidor ativo sobre exonerado no mês
    const ocupados = {};
    servidores.forEach(s => {
        const cargo = (s['Cargo'] || '').trim();
        const nome  = (s['Nome do Servidor'] || '').trim();
        if (!cargo || !nome) return;
        if (!ocupados[cargo] || !s.exoneradoNoMes) {
            ocupados[cargo] = { nome, exoneradoNoMes: s.exoneradoNoMes, exoneracao: s.exoneracao };
        }
    });

    // Grade
    const grade = document.getElementById('gradeCargos');
    grade.innerHTML = '';
    estrutura.forEach(cc => {
        const info = ocupados[cc];
        if (info) {
            const slotClass = info.exoneradoNoMes ? 'cargo-slot-exonerado' : 'cargo-slot-ocupado';
            const exoTag    = info.exoneradoNoMes
                ? `<span class="cargo-slot-exo">Exonerado em ${formatarData(info.exoneracao)}</span>`
                : '';
            grade.innerHTML += `
                <div class="cargo-slot ${slotClass}">
                    <span class="cargo-slot-cc">${cc}</span>
                    <span class="cargo-slot-nome">${info.nome}</span>
                    ${exoTag}
                    <span class="cargo-slot-status">${info.exoneradoNoMes ? '○ Exonerado' : '● Ocupado'}</span>
                </div>`;
        } else {
            grade.innerHTML += `
                <div class="cargo-slot cargo-slot-livre">
                    <span class="cargo-slot-cc">${cc}</span>
                    <span class="cargo-slot-nome">Vaga disponível</span>
                    <span class="cargo-slot-status">○ Livre</span>
                </div>`;
        }
    });

    // Alertas
    const alertas = [];
    const vagasLivres = estrutura.filter(cc => !ocupados[cc]);
    if (tipo === 'bloco') {
        if (vagasLivres.length > 0)                alertas.push({ tipo: 'aviso', msg: 'O cargo CC-8 desta lotação está vago.' });
        else if (ocupados['CC-8']?.exoneradoNoMes) alertas.push({ tipo: 'aviso', msg: 'O servidor CC-8 foi exonerado neste mês.' });
        else                                        alertas.push({ tipo: 'ok',   msg: 'Lotação regularmente ocupada.' });
    } else {
        if (vagasLivres.length === estrutura.length)   alertas.push({ tipo: 'aviso', msg: 'Nenhum cargo desta lotação está ocupado.' });
        else if (vagasLivres.length > 0)               alertas.push({ tipo: 'aviso', msg: `${vagasLivres.length} cargo(s) com vaga disponível: ${vagasLivres.join(', ')}.` });
        else                                            alertas.push({ tipo: 'ok',   msg: 'Todos os cargos da estrutura estão ocupados.' });
    }
    const exoneradosNoMes = servidores.filter(s => s.exoneradoNoMes);
    if (exoneradosNoMes.length > 0) {
        const nomes = exoneradosNoMes.map(s => (s['Nome do Servidor'] || '').trim()).join(', ');
        alertas.push({ tipo: 'aviso', msg: `Exonerado(s) neste mês: ${nomes}.` });
    }
    renderizarAlertas('alertasEspecial', alertas);

    // Tabela — com salário
    const tbody = document.getElementById('corpoTabelaEspecial');
    tbody.innerHTML = '';
    servidores.forEach(s => {
        const nome      = (s['Nome do Servidor'] || '').trim();
        const cargo     = (s['Cargo'] || '').trim();
        const matricula = (s['Matrícula'] || s['Matricula'] || '').trim();
        const sal       = tabelaCargos[cargo] || 0;
        const admStr    = s.admissao   ? formatarData(s.admissao)   : '—';
        const exoStr    = s.exoneracao ? formatarData(s.exoneracao) : '—';
        if (!nome) return;
        const exoTag = s.exoneradoNoMes ? `<span class="tag-exonerado">Exonerado</span>` : '';
        tbody.innerHTML += `
            <tr class="${s.exoneradoNoMes ? 'tr-exonerado' : ''}">
                <td class="col-matricula">${matricula || '—'}</td>
                <td>${nome}${exoTag}</td>
                <td>${cargo || '—'}</td>
                <td class="col-salario">${sal > 0 ? moeda(sal) : '—'}</td>
                <td class="col-data">${admStr}</td>
                <td class="col-data">${exoStr}</td>
            </tr>`;
    });
    if (!tbody.innerHTML) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted);font-style:italic;text-align:center;padding:16px">Nenhum servidor lotado neste período</td></tr>`;
    }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
function ocultarTudo() {
    document.getElementById('estadoInicial').style.display = 'none';
    document.getElementById('painelVereador').classList.add('escondido');
    document.getElementById('painelEspecial').classList.add('escondido');
    document.getElementById('topbarBadges').innerHTML = '';
    const mes = document.getElementById('mesSelect').value;
    const gab = document.getElementById('gabineteSelect').value;
    if (!mes || !gab) document.getElementById('estadoInicial').style.display = 'flex';
}

function renderizarAlertas(idEl, alertas) {
    const el = document.getElementById(idEl);
    el.innerHTML = '';
    const icons = {
        erro:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        aviso: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        ok:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    };
    alertas.forEach(a => {
        el.innerHTML += `<div class="alerta alerta-${a.tipo}">${icons[a.tipo]}<span>${a.msg}</span></div>`;
    });
}

// "DD/MM/AAAA" → Date
function parseData(str) {
    if (!str || !str.trim()) return null;
    const partes = str.trim().split('/');
    if (partes.length !== 3) return null;
    const [d, m, a] = partes.map(Number);
    if (!d || !m || !a) return null;
    return new Date(a, m - 1, d);
}

// "MM/AAAA" → { inicio, fim }
function intervaloMes(mesAno) {
    const [m, a] = mesAno.split('/').map(Number);
    return { inicio: new Date(a, m - 1, 1), fim: new Date(a, m, 0) };
}

function estaAtivo(admissao, exoneracao, inicio, fim) {
    if (!admissao) return false;
    if (admissao > fim) return false;
    if (exoneracao && exoneracao < inicio) return false;
    return true;
}

function moeda(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseMoeda(str) {
    // Aceita "12.000,00" e "12000.00"
    const s = str.toString().trim();
    if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    return parseFloat(s) || 0;
}

function formatarData(date) {
    if (!date) return '—';
    return date.toLocaleDateString('pt-BR');
}

function setStatus(tipo, msg) {
    document.querySelector('.status-dot').className = 'status-dot ' + tipo;
    document.getElementById('statusConexao').textContent = msg;
}

iniciar();
