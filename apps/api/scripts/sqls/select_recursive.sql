WITH RECURSIVE arvore_topicos AS (
    -- 1. Caso Base: O nó raiz (o ponto de partida da sua busca)
    SELECT 
        id,
        parent_id,
        title,
        status,
        content,
        1 AS nivel,
        CAST(id AS TEXT) AS caminho_hierarquia
    FROM topic_nodes
    WHERE id = 'c77c375e-3287-4e79-b3bd-6e04ccc8727f' -- Substitua pelo ID do pai inicial

    UNION ALL

    -- 2. Passo Recursivo: Busca os filhos vinculados ao parent_id dos itens anteriores
    SELECT 
        t.id,
        t.parent_id,
        t.title,
        t.status,
        t.content,
        at.nivel + 1,
        at.caminho_hierarquia || ' > ' || t.id
    FROM topic_nodes t
    JOIN arvore_topicos at ON t.parent_id = at.id
)
SELECT 
    nivel,
    id,
    parent_id,
    title,
    status,
    caminho_hierarquia
FROM arvore_topicos
ORDER BY caminho_hierarquia;