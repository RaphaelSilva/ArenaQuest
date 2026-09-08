update topic_nodes 
  set content=substr(content, 0, INSTR(content, '5\. Resumo Rápido para Agentes e Automação'))
where content like '%5\. Resumo Rápido para Agentes e Automação%';

update topic_nodes 
  set content=substr(content, 0, INSTR(content, '5\. Índice Estruturado para Automação (JSON Index)'))
where content like '%ndice Estruturado para Automação (JSON Index%';