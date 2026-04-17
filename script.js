// ─── CONFIGURAÇÃO ───────────────────────────────────────────────────────────
const BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSJq1BdeNlo6gvM1vBhtgD88MRevuRrODf2NmVESwH5CMQ6VBkuZMUaNEr8xCoHeJlmnlsJaDV_Cj9L/pub';

const URL_VERBAS     = BASE_URL + '?gid=0&single=true&output=csv';
const URL_SERVIDORES = BASE_URL + '?gid=SUBSTITUA_GID_SERVIDORES&single=true&output=csv';
const URL_CARGOS     = BASE_URL + '?gid=SUBSTITUA_GID_CARGOS&single=true&output=csv';
const URL_ESTRUTURAS = BASE_URL + '?gid=SUBSTITUA_GID_ESTRUTURAS&single=true&output=csv';

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
        // Extrai código CC do nome completo (ex: "CHEFE DE GABINETE - CC-1" → "CC-1")
        const match = cargo.toUpperCase().match(/CC-\d+/);
        const cc = match ? match[0] : cargo.toUpperCase();
        if (!estruturas[gab]) estruturas[gab] = [];
        estruturas[gab].push(cc);
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

    // ── Estrutura do gabinete (base para contagem de vagas) ──
    const estrutura = dadosEstruturas[gab] || [];
    const totalVagasEstrutura = estrutura.length;

    const saldo    = TETO_VEREADOR - verbaUtil;
    const pct      = TETO_VEREADOR > 0 ? Math.min((verbaUtil / TETO_VEREADOR) * 100, 100) : 0;
    const nServs   = servidores.filter(s => (s['Nome do Servidor'] || '').trim()).length;

    // Vagas disponíveis baseadas na estrutura escolhida, não em MAX_SERVIDORES fixo
    const vagasLiv = totalVagasEstrutura > 0 ? totalVagasEstrutura - nServs : MAX_SERVIDORES - nServs;
    const totalRef = totalVagasEstrutura > 0 ? totalVagasEstrutura : MAX_SERVIDORES;

    document.getElementById('vVerbaTotal').textContent    = moeda(TETO_VEREADOR);
    document.getElementById('vVerbaUtil').textContent     = moeda(verbaUtil);
    document.getElementById('vSaldo').textContent         = moeda(Math.abs(saldo));
    document.getElementById('vServidores').textContent    = `${nServs} / ${totalRef}`;
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
    // CC-1 detectado pelo sufixo "-CC-1" ou terminar em "CC-1" (nome completo pode variar)
    const temCC1 = servidores.some(s => {
        const c = (s['Cargo'] || '').trim().toUpperCase();
        return (c.endsWith('CC-1') || c.endsWith('- CC-1') || c === 'CC-1') && !s.exoneradoNoMes;
    });
    const alertas = [];
    if (!temCC1) alertas.push({ tipo: 'erro', msg: 'Chefe de Gabinete (CC-1) não está lotado. Este cargo é obrigatório.' });
    if (nServs > MAX_SERVIDORES) alertas.push({ tipo: 'erro', msg: `O gabinete possui ${nServs} servidores, acima do limite legal de ${MAX_SERVIDORES}.` });
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

    // ── Estrutura com bonecos ──
    const resumoEl = document.getElementById('vEstruturaResumo');
    const grade    = document.getElementById('gradeEstrutura');

    if (estrutura.length === 0) {
        grade.innerHTML = `<p style="font-size:14px;color:var(--muted);font-style:italic;padding:4px 0">Estrutura não cadastrada para este gabinete.</p>`;
        resumoEl.textContent = '';
    } else {
        // Cargos ativos = apenas os não-exonerados no mês (exonerado → slot fica vago)
        const cargosAtivosCC = servidores
            .filter(s => !s.exoneradoNoMes)
            .map(s => extrairCC(s['Cargo'] || ''));

        const vagosCount = estrutura.filter(cc => {
            const idx = cargosAtivosCC.indexOf(cc);
            if (idx !== -1) { cargosAtivosCC.splice(idx, 1); return false; }
            return true;
        }).length;

        // Reconstrói cargosAtivosCC para passar à função de render (foi consumido acima)
        const cargosAtivosCC2 = servidores
            .filter(s => !s.exoneradoNoMes)
            .map(s => extrairCC(s['Cargo'] || ''));

        resumoEl.textContent = vagosCount > 0
            ? `${vagosCount} vaga(s) livre(s) de ${estrutura.length}`
            : `${estrutura.length} de ${estrutura.length} preenchidos`;

        grade.innerHTML = renderizarEstruturaCCs(estrutura, cargosAtivosCC2);
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

// Extrai o código CC do nome completo do cargo
// "CHEFE DE GABINETE PARLAMENTAR - CC-1" → "CC-1"
function extrairCC(nomeCargo) {
    const match = nomeCargo.trim().toUpperCase().match(/CC-\d+/);
    return match ? match[0] : nomeCargo.trim().toUpperCase();
}

// Renderiza a estrutura do gabinete agrupada por CC com disposição triangular
function renderizarEstruturaCCs(estrutura, cargosAtivosCC) {
    const consumivel = [...cargosAtivosCC];

    const slots = estrutura.map(cc => {
        const idx = consumivel.indexOf(cc);
        if (idx !== -1) { consumivel.splice(idx, 1); return { cc, estado: 'ocupado' }; }
        return { cc, estado: 'vago' };
    });

    // Agrupa por CC preservando ordem de primeiro aparecimento
    const ordem = [];
    const grupos = {};
    slots.forEach(s => {
        if (!grupos[s.cc]) { grupos[s.cc] = []; ordem.push(s.cc); }
        grupos[s.cc].push(s.estado);
    });

    let html = '';
    ordem.forEach(cc => {
        const lista = grupos[cc];
        const n = lista.length;
        const ocupados = lista.filter(e => e === 'ocupado').length;
        const subTexto = `${ocupados}/${n}`;

        const linhas = distribuirLinhas(lista);

        let linhasHTML = '';
        linhas.forEach(linha => {
            const cardsHTML = linha.map(estado => `
                <div class="cc-card ${estado}">
                    <span class="cc-card-label">${cc}</span>
                    <span class="cc-card-status">${estado === 'ocupado' ? '● ocupado' : '○ vago'}</span>
                </div>`).join('');
            linhasHTML += `<div class="grupo-cc-linha">${cardsHTML}</div>`;
        });

        html += `
            <div class="grupo-cc">
                ${linhasHTML}
                <span class="grupo-cc-sub">${subTexto} ocupado${ocupados !== 1 ? 's' : ''}</span>
            </div>`;
    });

    return html;
}

// Distribui N itens em linhas para disposição triangular/agrupada
function distribuirLinhas(lista) {
    const n = lista.length;
    if (n <= 2) return [lista];
    if (n === 3) return [lista.slice(0, 2), lista.slice(2)];
    if (n === 4) return [lista.slice(0, 2), lista.slice(2)];
    if (n === 5) return [lista.slice(0, 3), lista.slice(3)];
    if (n === 6) return [lista.slice(0, 3), lista.slice(3)];
    if (n === 7) return [lista.slice(0, 4), lista.slice(4)];
    if (n === 8) return [lista.slice(0, 4), lista.slice(4)];
    // 9: pirâmide 3+3+3
    return [lista.slice(0, 3), lista.slice(3, 6), lista.slice(6)];
}


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
