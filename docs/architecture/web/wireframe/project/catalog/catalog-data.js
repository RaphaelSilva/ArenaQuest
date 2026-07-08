// Catalog tree data — recursive: every node has the same shape.
// Each node: { id, title, description (markdown), media[], children[] }
// media item: { id, kind: 'video'|'audio'|'pdf', title, src, duration?, size?, pages? }

window.CATALOG_TREE = {
  id: 'root',
  title: 'Catálogo',
  description: 'Biblioteca completa de conteúdos didáticos do ArenaQuest, organizada por hierarquia de Kyu, técnicas e fundamentos.',
  media: [],
  children: [
    {
      id: 'bem-vindo',
      title: 'Bem-vindo ao Butoku Dojo',
      description: '## Introdução\n\nEste é o **ponto de partida** para todos os praticantes. Aqui apresentamos:\n\n- A filosofia do dojo e seu código de conduta\n- A estrutura de progressão por *Kyu* (graduações)\n- As três dimensões do treino: **corpo**, **técnica** e **espírito**\n\n> "O caminho marcial não é o caminho da vitória sobre o outro — é o caminho da vitória sobre si mesmo."',
      media: [
        { id: 'v-welcome', kind: 'video', title: 'Mensagem do Sensei', duration: '04:12', src: '#' },
        { id: 'p-codigo', kind: 'pdf', title: 'Código de conduta do dojo.pdf', size: '420 KB', pages: 6, src: '#' },
      ],
      children: [],
    },
    {
      id: '9-kyu',
      title: '9º Kyu',
      description: '## 9º Kyu — 14 técnicas\n\n*Foco no movimento do corpo.*\n\n**Nota:** Quando o número de técnicas é listado, este número refere-se a *KATAS* realizados contra um Uke.\n\n- **Teoria / Demonstração Inicial:** Explique o que é *Junan Taiso* e demonstre algumas de suas técnicas.\n- **Ninpo Taijutsu Ten Chi Jin**\n- Trabalhar o reconhecimento de distância (*Maai*) e a postura natural (*Shizen no Kamae*).',
      media: [
        { id: 'v-9kyu-intro', kind: 'video', title: 'Visão geral do 9º Kyu', duration: '12:34', src: '#' },
        { id: 'a-9kyu-podcast', kind: 'audio', title: 'Conversa com o Sensei — base do 9º Kyu', duration: '28:50', src: '#' },
        { id: 'p-9kyu-manual', kind: 'pdf', title: 'Manual do 9º Kyu — técnicas e ordem.pdf', size: '2.4 MB', pages: 48, src: '#' },
      ],
      children: [
        {
          id: 'kamae',
          title: 'Kamae',
          description: '## Kamae — posturas fundamentais\n\n*Shizen tai no Kamae* (postura natural). Todos os exemplos devem ser iniciados a partir desta posição neutra antes de se transformarem em posturas de combate.\n\n- **Shizen no Kamae** — postura natural, ombros relaxados\n- **Ichimonji no Kamae** — perfil lateral, peso no pé traseiro\n- **Hira no Kamae** — frontal aberto, braços em cruz\n- **Jumonji no Kamae** — braços cruzados em proteção\n\n> *Kamae* não é apenas postura: é estado de prontidão.',
          media: [
            { id: 'v-kamae-1', kind: 'video', title: 'Shizen no Kamae — execução', duration: '03:21', src: '#' },
            { id: 'v-kamae-2', kind: 'video', title: 'Ichimonji no Kamae — detalhes', duration: '05:47', src: '#' },
            { id: 'v-kamae-3', kind: 'video', title: 'Variações — Hira e Jumonji', duration: '07:02', src: '#' },
          ],
          children: [
            {
              id: 'shizen',
              title: 'Shizen no Kamae',
              description: '## Shizen no Kamae\n\nA postura natural — ponto de partida e ponto de retorno.\n\n- Pés paralelos, largura dos ombros\n- Joelhos levemente flexionados\n- Coluna alinhada, queixo recolhido\n- Mãos relaxadas ao longo do corpo',
              media: [
                { id: 'v-shizen', kind: 'video', title: 'Shizen — vista 360°', duration: '02:18', src: '#' },
                { id: 'a-shizen', kind: 'audio', title: 'Áudio guia de alinhamento', duration: '04:30', src: '#' },
              ],
              children: [],
            },
            {
              id: 'ichimonji',
              title: 'Ichimonji no Kamae',
              description: '## Ichimonji no Kamae\n\nA "linha reta" — postura de defesa por excelência.\n\n- Perfil lateral em relação ao oponente\n- 70% do peso no pé traseiro\n- Braço dianteiro estendido, traseiro recolhido',
              media: [
                { id: 'v-ichimonji', kind: 'video', title: 'Ichimonji — passo a passo', duration: '06:42', src: '#' },
                { id: 'p-ichimonji', kind: 'pdf', title: 'Diagramas Ichimonji.pdf', size: '1.1 MB', pages: 4, src: '#' },
              ],
              children: [],
            },
            {
              id: 'hira',
              title: 'Hira no Kamae',
              description: '## Hira no Kamae\n\nPostura de abertura, recepção e leitura.',
              media: [
                { id: 'v-hira', kind: 'video', title: 'Hira no Kamae', duration: '04:08', src: '#' },
              ],
              children: [],
            },
          ],
        },
        {
          id: 'taihen-jutsu',
          title: 'Taihen Jutsu',
          description: '## Taihen Jutsu — técnica corporal\n\n**Mae Gaeshi**: Técnicas para a frente. **Yoko Gaeshi**: para o lado. **Ushiro Gaeshi**: para trás.\n\nFundamentos de queda, rolamento e recuperação. O corpo aprende a *receber* o solo.',
          media: [
            { id: 'v-taihen-1', kind: 'video', title: 'Mae Gaeshi — rolamento frontal', duration: '08:12', src: '#' },
            { id: 'v-taihen-2', kind: 'video', title: 'Yoko Gaeshi — rolamento lateral', duration: '06:45', src: '#' },
            { id: 'v-taihen-3', kind: 'video', title: 'Ushiro Gaeshi — rolamento traseiro', duration: '07:30', src: '#' },
            { id: 'p-taihen', kind: 'pdf', title: 'Taihen Jutsu — guia completo.pdf', size: '3.2 MB', pages: 22, src: '#' },
            { id: 'a-taihen', kind: 'audio', title: 'Princípios do rolamento — narração', duration: '15:20', src: '#' },
          ],
          children: [
            {
              id: 'mae-gaeshi',
              title: 'Mae Gaeshi',
              description: '## Mae Gaeshi\n\nRolamento frontal — recupera-se em pé pronto para continuar.',
              media: [
                { id: 'v-mg-1', kind: 'video', title: 'Mae Gaeshi — versão lenta', duration: '03:14', src: '#' },
                { id: 'v-mg-2', kind: 'video', title: 'Mae Gaeshi — versão completa', duration: '02:48', src: '#' },
              ],
              children: [],
            },
            {
              id: 'yoko-gaeshi',
              title: 'Yoko Gaeshi',
              description: '## Yoko Gaeshi\n\nRolamento lateral. Dispersa força horizontalmente.',
              media: [
                { id: 'v-yg', kind: 'video', title: 'Yoko Gaeshi — demonstração', duration: '04:12', src: '#' },
              ],
              children: [],
            },
          ],
        },
        {
          id: 'ukemi',
          title: 'Ukemi',
          description: '## Ukemi — a arte de receber\n\n*Ukemi* significa "corpo que recebe". Sem ukemi sólido, não há treino seguro.\n\n- **Zenpo Ukemi** — queda à frente\n- **Koho Ukemi** — queda para trás\n- **Yoko Ukemi** — queda lateral',
          media: [
            { id: 'v-ukemi-1', kind: 'video', title: 'Ukemi — fundamentos', duration: '09:55', src: '#' },
            { id: 'v-ukemi-2', kind: 'video', title: 'Erros comuns em ukemi', duration: '06:22', src: '#' },
          ],
          children: [],
        },
        {
          id: 'kaiten',
          title: 'Kaiten',
          description: '## Kaiten — rotação\n\nMovimento giratório utilizado em deslocamento, evasão e projeção.',
          media: [
            { id: 'v-kaiten', kind: 'video', title: 'Kaiten — princípios', duration: '05:40', src: '#' },
          ],
          children: [],
        },
        {
          id: 'shiho-tenchi-tobi',
          title: 'Shiho Tenchi Tobi',
          description: '## Shiho Tenchi Tobi\n\nSaltos nas quatro direções — céu e terra. Trabalha explosão, controle e aterrissagem.',
          media: [
            { id: 'v-stt', kind: 'video', title: 'Shiho Tenchi Tobi — sequência', duration: '11:08', src: '#' },
            { id: 'p-stt', kind: 'pdf', title: 'Diagrama das 4 direções.pdf', size: '680 KB', pages: 2, src: '#' },
          ],
          children: [],
        },
        {
          id: 'ryu-sui-nagare',
          title: 'Ryu Sui Nagare',
          description: '## Ryu Sui Nagare — fluxo de água corrente\n\nDeslocamento contínuo, sem pausas. O corpo se torna água.',
          media: [
            { id: 'v-rsn', kind: 'video', title: 'Ryu Sui Nagare — vista lateral', duration: '08:30', src: '#' },
            { id: 'a-rsn', kind: 'audio', title: 'Meditação guiada — fluxo', duration: '12:00', src: '#' },
          ],
          children: [],
        },
      ],
    },
    {
      id: '8-kyu',
      title: '8º Kyu',
      description: '## 8º Kyu — técnicas adicionais\n\n*Foco em transições e início de aplicações de Kihon Happo.*',
      media: [
        { id: 'v-8kyu', kind: 'video', title: 'Visão geral do 8º Kyu', duration: '14:20', src: '#' },
        { id: 'p-8kyu', kind: 'pdf', title: 'Manual do 8º Kyu.pdf', size: '2.8 MB', pages: 52, src: '#' },
      ],
      children: [
        {
          id: 'go-gyo',
          title: 'Go Gyo no Kata',
          description: '## Go Gyo no Kata — os 5 elementos\n\nÁgua, terra, fogo, vento e vazio. Cada elemento expressa uma qualidade de ataque e movimento.',
          media: [
            { id: 'v-gogyo-1', kind: 'video', title: 'Chi no Kata — terra', duration: '06:12', src: '#' },
            { id: 'v-gogyo-2', kind: 'video', title: 'Sui no Kata — água', duration: '06:45', src: '#' },
            { id: 'v-gogyo-3', kind: 'video', title: 'Ka no Kata — fogo', duration: '07:10', src: '#' },
            { id: 'v-gogyo-4', kind: 'video', title: 'Fu no Kata — vento', duration: '06:58', src: '#' },
            { id: 'v-gogyo-5', kind: 'video', title: 'Ku no Kata — vazio', duration: '08:22', src: '#' },
          ],
          children: [],
        },
        {
          id: '8-taihen',
          title: 'Taihen Jutsu (8º)',
          description: '## Taihen Jutsu avançado\n\nAprofundamento das quedas com aplicação contra ataque.',
          media: [
            { id: 'v-8taihen', kind: 'video', title: 'Taihen com aplicação', duration: '10:15', src: '#' },
          ],
          children: [],
        },
      ],
    },
    {
      id: 'fundamentos',
      title: 'Fundamentos do Movimento',
      description: '## Fundamentos transversais\n\nConteúdo que perpassa todas as graduações: postura, respiração, distância, tempo.',
      media: [
        { id: 'a-fund', kind: 'audio', title: 'Os quatro pilares — narração', duration: '18:42', src: '#' },
        { id: 'p-fund', kind: 'pdf', title: 'Fundamentos do movimento.pdf', size: '1.6 MB', pages: 28, src: '#' },
      ],
      children: [
        {
          id: 'postura',
          title: 'Postura e Alinhamento',
          description: '## Postura — a base de tudo\n\n- Coluna neutra\n- Centro de gravidade baixo (*hara*)\n- Olhar à frente, queixo recolhido',
          media: [
            { id: 'v-post', kind: 'video', title: 'Postura — análise lateral', duration: '07:18', src: '#' },
          ],
          children: [],
        },
        {
          id: 'respiracao',
          title: 'Respiração',
          description: '## Respiração — *Kokyu*\n\nA respiração coordena a técnica. *Inspiração curta na recepção, expiração longa na ação.*',
          media: [
            { id: 'a-resp', kind: 'audio', title: 'Exercício de respiração — 10 min', duration: '10:00', src: '#' },
            { id: 'v-resp', kind: 'video', title: 'Demonstração de respiração coordenada', duration: '05:25', src: '#' },
          ],
          children: [],
        },
        {
          id: 'maai',
          title: 'Maai — distância',
          description: '## Maai\n\nA distância correta entre você e o oponente. Nem perto demais (vulnerável), nem longe demais (ineficaz).',
          media: [
            { id: 'v-maai', kind: 'video', title: 'Maai — três zonas', duration: '08:55', src: '#' },
            { id: 'p-maai', kind: 'pdf', title: 'Maai — diagramas de zona.pdf', size: '900 KB', pages: 8, src: '#' },
          ],
          children: [],
        },
      ],
    },
  ],
};

// Discussions stored per topic id (mocked).
window.CATALOG_COMMENTS = {
  '9-kyu': [
    { id: 1, name: 'Mariana Costa', initials: 'MC', time: '2h atrás', badge: 'Instrutora',
      text: 'Pessoal, lembrem que o 9º Kyu é sobre **construir o vocabulário corporal**. Não tentem acelerar — repetição lenta é o caminho.',
      likes: 12, replies: [
        { id: 11, name: 'João Silva', initials: 'JS', time: '1h atrás', text: 'Faz sentido. Vou voltar pro Kamae antes de avançar.' },
      ]},
    { id: 2, name: 'Rafael Mendes', initials: 'RM', time: '5h atrás',
      text: 'Alguém tem material adicional sobre Shiho Tenchi Tobi? Estou penando na aterrissagem.',
      likes: 4, replies: [] },
  ],
  'kamae': [
    { id: 1, name: 'Aline Torres', initials: 'AT', time: '1 dia atrás',
      text: 'O vídeo do Ichimonji é excelente — o detalhe da distribuição de peso no pé traseiro mudou minha estabilidade.',
      likes: 9, replies: [] },
  ],
  'taihen-jutsu': [
    { id: 1, name: 'Carlos Eiji', initials: 'CE', time: '3h atrás', badge: 'Instrutor',
      text: 'Lembrem: queda sem som é o objetivo. Se vocês escutam o tapete, ainda há tensão para soltar.',
      likes: 21, replies: [] },
  ],
};
