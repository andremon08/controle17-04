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
    setStatus('', 'Carregando...');

    Promise.all([
        carregarCSV(URL_VERBAS,     'verbas'),
        carregarCSV(URL_SERVIDORES, 'servidores'),
        carregarCSV(URL_CARGOS,     'cargos'),
        carregarCSV(URL_ESTRUTURAS, 'estruturas'),
    ])
    .then(([verbas, servidores, cargos, estruturas]) => {
        try {
            dadosVerbas     = verbas;
            dadosServidores = servidores;
            tabelaCargos    = construirTabelaCargos(cargos);
            dadosEstruturas = construirEstruturas(estruturas);
            preencherFiltros();
            setStatus('ok', 'Dados carregados');
        } catch (err) {
            console.error('[Erro ao processar dados]', err);
            setStatus('erro', 'Erro ao processar dados');
        }
    })
    .catch(err => {
        console.error('[Erro ao carregar]', err);
        setStatus('erro', typeof err === 'string' ? err : 'Erro ao carregar dados');
    });
}

function carregarCSV(url, nome) {
    return new Promise((resolve, reject) => {
        // Timeout de 15s para não ficar pendurado
        const timer = setTimeout(() => {
            reject(`Timeout ao carregar "${nome}". Verifique se a planilha está publicada.`);
        }, 15000);

        Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: r => {
                clearTimeout(timer);
                if (!r.data || r.data.length === 0) {
                    console.warn(`[${nome}] Aba vazia ou sem dados.`);
                }
                resolve(r.data || []);
            },
            error: e => {
                clearTimeout(timer);
                console.error(`[${nome}] Erro PapaParse:`, e);
                // Resolve com array vazio em vez de rejeitar, para não travar tudo
                // caso uma aba ainda não tenha dados
                resolve([]);
            },
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

// ─── FILTROS — CUSTOM AUTOCOMPLETE ─────────────────────────────────────────
let _opsMes = [];
let _opsGab = [];

function preencherFiltros() {
    const mesesSet = new Set();
    const gabSet   = new Set();

    dadosVerbas.forEach(l => {
        if (l['Mês'])      mesesSet.add(l['Mês'].trim());
        if (l['Gabinete']) gabSet.add(l['Gabinete'].trim());
    });

    _opsMes = [...mesesSet].sort((a, b) => {
        const [ma, aa] = a.split('/').map(Number);
        const [mb, ab] = b.split('/').map(Number);
        return aa !== ab ? aa - ab : ma - mb;
    });
    _opsGab = [...gabSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    iniciarAutocomplete('mesInput', 'dropMes', 'wrapMes', 'mesSelect', _opsMes);
    iniciarAutocomplete('gabInput', 'dropGab', 'wrapGab', 'gabineteSelect', _opsGab);
}

function iniciarAutocomplete(inputId, dropId, wrapId, hiddenId, opcoes) {
    const input  = document.getElementById(inputId);
    const drop   = document.getElementById(dropId);
    const wrap   = document.getElementById(wrapId);
    const hidden = document.getElementById(hiddenId);

    // Ghost span para autocomplete cinza
    const ghost = document.createElement('div');
    ghost.className = 'custom-select-ghost';
    wrap.appendChild(ghost);

    function renderDrop(filtro) {
        const q = (filtro || '').toLowerCase();
        const lista = q
            ? opcoes.filter(o => o.toLowerCase().includes(q))
            : opcoes;

        drop.innerHTML = '';
        if (lista.length === 0) {
            drop.innerHTML = `<div style="padding:10px 12px;font-size:13px;color:var(--muted)">Nenhum resultado</div>`;
            return;
        }
        lista.forEach(op => {
            const div = document.createElement('div');
            div.className = 'custom-select-option' + (op === hidden.value ? ' selecionado' : '');
            // Destaca parte digitada
            if (q) {
                const idx = op.toLowerCase().indexOf(q);
                div.innerHTML = op.slice(0, idx)
                    + `<strong>${op.slice(idx, idx + q.length)}</strong>`
                    + op.slice(idx + q.length);
            } else {
                div.textContent = op;
            }
            div.addEventListener('mousedown', e => {
                e.preventDefault();
                selecionar(op);
            });
            drop.appendChild(div);
        });
    }

    function selecionar(valor) {
        hidden.value = valor;
        input.value  = valor;
        ghost.textContent = '';
        fechar();
        atualizarPainel();
    }

    function abrir() {
        wrap.classList.add('aberto');
        renderDrop(input.value);
    }

    function fechar() {
        wrap.classList.remove('aberto');
        ghost.textContent = '';
    }

    function atualizarGhost(digitado) {
        if (!digitado) { ghost.textContent = ''; return; }
        const match = opcoes.find(o => o.toLowerCase().startsWith(digitado.toLowerCase()));
        if (match && match.toLowerCase() !== digitado.toLowerCase()) {
            ghost.textContent = digitado + match.slice(digitado.length);
        } else {
            ghost.textContent = '';
        }
    }

    input.addEventListener('focus', () => abrir());
    input.addEventListener('input', () => {
        hidden.value = '';
        atualizarGhost(input.value);
        renderDrop(input.value);
        if (!wrap.classList.contains('aberto')) abrir();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Tab' || e.key === 'ArrowRight') {
            const g = ghost.textContent;
            if (g) { e.preventDefault(); selecionar(g); }
        }
        if (e.key === 'Enter') {
            const first = drop.querySelector('.custom-select-option');
            if (first) { selecionar(first.textContent.replace(/\s+/g, ' ').trim()); }
        }
        if (e.key === 'Escape') { fechar(); input.blur(); }
    });
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (!opcoes.includes(input.value)) {
                input.value  = hidden.value || '';
                ghost.textContent = '';
            }
            fechar();
        }, 150);
    });
}

// Listener único para fechar dropdowns ao clicar fora
document.addEventListener('click', e => {
    ['wrapMes', 'wrapGab'].forEach(id => {
        const wrap = document.getElementById(id);
        if (wrap && !wrap.contains(e.target)) {
            wrap.classList.remove('aberto');
        }
    });
});


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

    // Separa servidores ativos (não exonerados) dos exonerados no mês
    const servsAtivos    = servidores.filter(s => !s.exoneradoNoMes);
    const servsExonerados = servidores.filter(s => s.exoneradoNoMes);

    // Verba utilizada considera apenas ativos (exonerado = vaga liberada)
    let verbaUtil = 0;
    servsAtivos.forEach(s => {
        const cargo = (s['Cargo'] || '').trim();
        verbaUtil += tabelaCargos[cargo] || 0;
    });

    // ── Estrutura do gabinete ──
    const estrutura = dadosEstruturas[gab] || [];
    const totalVagasEstrutura = estrutura.length;

    const saldo  = TETO_VEREADOR - verbaUtil;
    const pct    = TETO_VEREADOR > 0 ? Math.min((verbaUtil / TETO_VEREADOR) * 100, 100) : 0;
    const nServs = servsAtivos.filter(s => (s['Nome do Servidor'] || '').trim()).length;

    // Vagas baseadas na estrutura; exonerados no mês liberam vagas
    const totalRef = totalVagasEstrutura > 0 ? totalVagasEstrutura : MAX_SERVIDORES;
    const vagasLiv = totalRef - nServs;

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
    const temCC1 = servsAtivos.some(s => {
        const c = (s['Cargo'] || '').trim().toUpperCase();
        return (c.endsWith('CC-1') || c.endsWith('- CC-1') || c === 'CC-1');
    });
    const alertas = [];
    if (!temCC1) alertas.push({ tipo: 'erro', msg: 'Chefe de Gabinete (CC-1) não está lotado. Este cargo é obrigatório.' });
    if (nServs > MAX_SERVIDORES) alertas.push({ tipo: 'erro', msg: `O gabinete possui ${nServs} servidores, acima do limite legal de ${MAX_SERVIDORES}.` });
    if (verbaUtil > TETO_VEREADOR + TOLERANCIA) {
        alertas.push({ tipo: 'erro', msg: `Verba utilizada (${moeda(verbaUtil)}) excede o teto legal de ${moeda(TETO_VEREADOR)}.` });
    } else if (verbaUtil > TETO_VEREADOR) {
        alertas.push({ tipo: 'aviso', msg: 'Verba dentro da margem de tolerância de R$ 0,13.' });
    }
    if (servsExonerados.length > 0) {
        const nomes = servsExonerados.map(s => (s['Nome do Servidor'] || '').trim()).join(', ');
        alertas.push({ tipo: 'aviso', msg: `Exonerado(s) neste mês: ${nomes}.` });
    }
    if (alertas.length === 0) alertas.push({ tipo: 'ok', msg: 'Gabinete em conformidade com as regras legais.' });
    renderizarAlertas('alertasVereador', alertas);

    // ── Estrutura com cards agrupados ──
    const resumoEl = document.getElementById('vEstruturaResumo');
    const grade    = document.getElementById('gradeEstrutura');

    if (estrutura.length === 0) {
        grade.innerHTML = `<p style="font-size:14px;color:var(--muted);font-style:italic;padding:4px 0">Estrutura não cadastrada para este gabinete.</p>`;
        resumoEl.textContent = '';
    } else {
        const cargosAtivosCC = servsAtivos.map(s => extrairCC(s['Cargo'] || ''));
        // Conta vagos para resumo
        const cargosTemp = [...cargosAtivosCC];
        const vagosCount = estrutura.filter(cc => {
            const idx = cargosTemp.indexOf(cc);
            if (idx !== -1) { cargosTemp.splice(idx, 1); return false; }
            return true;
        }).length;

        resumoEl.textContent = vagosCount > 0
            ? `${vagosCount} vaga(s) livre(s) de ${estrutura.length}`
            : `${estrutura.length} de ${estrutura.length} preenchidos`;

        grade.innerHTML = renderizarEstruturaCCs(estrutura, cargosAtivosCC);
    }

    // ── Tabela servidores ──
    const tbody = document.getElementById('corpoTabelaVereador');
    const tfoot = document.getElementById('rodapeTabelaVereador');
    tbody.innerHTML = '';

    // Verba total tabela inclui todos (ativos + exonerados no mês para histórico)
    let verbaTotalTabela = 0;
    servidores.forEach(s => {
        const nome      = (s['Nome do Servidor'] || '').trim();
        const cargo     = (s['Cargo'] || '').trim();
        const matricula = (s['Matrícula'] || s['Matricula'] || '').trim();
        const sal       = tabelaCargos[cargo] || 0;
        const admStr    = s.admissao   ? formatarData(s.admissao)   : '—';
        const exoStr    = s.exoneracao ? formatarData(s.exoneracao) : '—';
        if (!nome) return;
        if (!s.exoneradoNoMes) verbaTotalTabela += sal;
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

    tfoot.innerHTML = `
        <tr>
            <td colspan="3">Total em vigor</td>
            <td class="col-salario col-salario-total">${moeda(verbaUtil)}</td>
            <td colspan="2"></td>
        </tr>`;

    // ── Sugestão de Composição ──
    renderizarSugestao(gab, estrutura, saldo, nServs);
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

// ─── SUGESTÃO DE COMPOSIÇÃO ─────────────────────────────────────────────────
function renderizarSugestao(gab, estruturaAtual, saldo, nServsAtivos) {
    const secao    = document.getElementById('secaoSugestao');
    const conteudo = document.getElementById('sugestaoConteudo');
    const resumo   = document.getElementById('sugestaoResumo');

    const vagasNaEstrutura = estruturaAtual.length;
    const vagasRestantes   = MAX_SERVIDORES - vagasNaEstrutura;

    // Só mostra se há espaço na estrutura (menos de 9 cargos) E saldo disponível
    if (vagasRestantes <= 0 || saldo <= 0) {
        secao.classList.add('escondido');
        return;
    }
    secao.classList.remove('escondido');

    // CCs disponíveis ordenados do menor para o maior salário
    const ccsDisponiveis = Object.entries(tabelaCargos)
        .map(([nome, sal]) => ({ cc: extrairCC(nome), sal }))
        .filter(x => x.cc.startsWith('CC-'))
        .sort((a, b) => a.sal - b.sal);

    // Remove duplicatas (mesmo CC code, mantém o salário)
    const ccMap = {};
    ccsDisponiveis.forEach(x => { if (!ccMap[x.cc]) ccMap[x.cc] = x.sal; });
    const ccsSorted = Object.entries(ccMap)
        .map(([cc, sal]) => ({ cc, sal }))
        .sort((a, b) => a.sal - b.sal);

    // Gera combinações de 1 até vagasRestantes cargos que cabem no saldo
    // Estratégia: mostra até 6 sugestões variadas (mínimo custo, máximo custo, e opções mistas)
    const sugestoes = [];

    // Combinações simples: 1 a vagasRestantes do mesmo CC
    ccsSorted.forEach(({ cc, sal }) => {
        for (let qtd = 1; qtd <= vagasRestantes; qtd++) {
            const custo = sal * qtd;
            if (custo <= saldo + TOLERANCIA) {
                sugestoes.push({ ccs: Array(qtd).fill(cc), custo });
            }
        }
    });

    // Combinações de 2 CCs diferentes
    if (vagasRestantes >= 2) {
        for (let i = 0; i < ccsSorted.length; i++) {
            for (let j = i; j < ccsSorted.length; j++) {
                const custo = ccsSorted[i].sal + ccsSorted[j].sal;
                if (custo <= saldo + TOLERANCIA) {
                    sugestoes.push({ ccs: [ccsSorted[i].cc, ccsSorted[j].cc], custo });
                }
            }
        }
    }

    if (sugestoes.length === 0) {
        conteudo.innerHTML = `<p class="sugestao-intro">Não há cargos que caibam no saldo disponível de ${moeda(saldo)}.</p>`;
        resumo.textContent = 'sem opções disponíveis';
        return;
    }

    // Ordena por custo decrescente (aproveita mais o saldo), limita a 8 sugestões
    sugestoes.sort((a, b) => b.custo - a.custo);
    // Remove duplicatas por string de CCs
    const vistos = new Set();
    const unicas = sugestoes.filter(s => {
        const chave = s.ccs.slice().sort().join('+');
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
    }).slice(0, 8);

    resumo.textContent = `${vagasRestantes} vaga(s) disponível — saldo ${moeda(saldo)}`;

    const intro = `<p class="sugestao-intro">
        O gabinete possui ${vagasNaEstrutura} cargo(s) na estrutura atual e pode incluir até
        <strong>${vagasRestantes}</strong> cargo(s) adicional(is) sem ultrapassar o teto de ${moeda(TETO_VEREADOR)}.
        Abaixo estão combinações possíveis dentro do saldo disponível de <strong>${moeda(saldo)}</strong>:
    </p>`;

    const cards = unicas.map(s => {
        const saldoPos = saldo - s.custo;
        const ccsLabel = s.ccs.join(' + ');
        return `
            <div class="sugestao-card">
                <div class="sugestao-card-titulo">${s.ccs.length} cargo(s) adicional(is)</div>
                <div class="sugestao-card-ccs">${ccsLabel}</div>
                <div class="sugestao-card-total">+ ${moeda(s.custo)}</div>
                <div class="sugestao-card-saldo">Saldo restante: ${moeda(saldoPos)}</div>
            </div>`;
    }).join('');

    conteudo.innerHTML = intro + `<div class="sugestao-grid">${cards}</div>`;
}



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
    document.getElementById('secaoSugestao').classList.add('escondido');
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
    const dot = document.querySelector('.status-dot');
    const txt = document.getElementById('statusConexao');
    dot.className = 'status-dot' + (tipo ? ' ' + tipo : '');
    txt.textContent = msg;
}

iniciar();
