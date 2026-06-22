# Guardrails de Design System — Plataforma de Governança de Bens Sensíveis

> **Versão:** 1.0  
> **Data:** 2026-06-20  
> **Propósito:** Garantir consistência visual em todas as fases de desenvolvimento enterprise  
> **Autoridade:** Nenhuma UI nova pode ser aprovada se violar estas regras

---

## Regra Fundamental

**Toda nova UI deve reutilizar componentes existentes sempre que possível. Nunca criar uma identidade visual diferente por módulo. Nunca mudar tema, cores, bordas, espaçamentos ou linguagem sem justificativa documentada e aprovação.**

---

## 1. Princípios Visuais Atuais

O design system do produto é **institucional, dark, limpo e operacional**. Não é um app de consumo. É uma ferramenta de trabalho usada por militares em ambiente de pressão.

| Princípio | O que significa na prática |
|---|---|
| **Institucional** | Sem gradientes decorativos, sem animações chamativas, sem emojis em texto de UI |
| **Dark** | Tema escuro como padrão único — sem toggle de tema claro |
| **Operacional** | Densidade de informação moderada; dados visíveis sem scroll excessivo |
| **Hierarquia clara** | O que é primário está visualmente separado do secundário |
| **Feedback imediato** | Toda ação tem resposta visual em ≤ 300ms |

---

## 2. Tokens de Cor

Estes são os tokens definidos no design system atual. **Nunca usar hexadecimais hardcoded no código — usar variáveis CSS/Tailwind.**

### Cores base (verificar em `apps/web/src/app/globals.css`)

| Token | Papel | Uso |
|---|---|---|
| `background` | Fundo de página | `bg-background` |
| `foreground` | Texto principal | `text-foreground` |
| `card` | Fundo de cards | `bg-card` |
| `card-foreground` | Texto em cards | `text-card-foreground` |
| `popover` | Fundo de popovers/dropdowns | `bg-popover` |
| `muted` | Fundo de elementos de apoio | `bg-muted` |
| `muted-foreground` | Texto secundário | `text-muted-foreground` |
| `border` | Bordas | `border` |
| `primary` | Cor de ação principal | `bg-primary`, `text-primary` |
| `primary-foreground` | Texto sobre primary | `text-primary-foreground` |
| `destructive` | Ações destrutivas / erros | `bg-destructive`, `text-destructive` |
| `ring` | Focus ring | `ring` |
| `accent` | Destaque secundário | `bg-accent` |

### Referência de valores aproximados (dark theme)
```
background:     #0d1117  (quase preto — fundo de página)
card:           #161b22  (ligeiramente mais claro — fundo de card)
border:         #30363d  (bordas sutis)
primary:        #1B3A8C  (azul institutional — botões, badges ativos)
muted:          #21262d  (fundo de elementos muted)
destructive:    #dc2626  (vermelho — erros, ações destrutivas)
```

**Nunca usar cores fora destes tokens sem alterar o design system e documentar.**

---

## 3. Layout

### AppShell (`apps/web/src/components/layout/app-shell.tsx`)

O layout base de todas as páginas protegidas. **Nunca criar um novo layout — usar AppShell.**

```
┌─────────────────────────────────────────────────────┐
│  Sidebar (desktop ≥ 1024px)    │  Main Content       │
│  ─────────────────────────────  │  ──────────────── │
│  Logo                          │  Header (opcional)  │
│  Nav links por role            │  Page content       │
│  User info + logout            │                     │
└────────────────────────────────────────────────────-─┘

┌─────────────────────────────────────────────────────┐
│  Header mobile (< 1024px)                            │
│  ─────────────────────────────────────────────────  │
│  Page content                                        │
│  ─────────────────────────────────────────────────  │
│  Bottom Navigation (mobile)                          │
└─────────────────────────────────────────────────────┘
```

### Regras de layout
- **Desktop (≥ 1024px):** sidebar fixa + conteúdo principal com `flex-1`
- **Mobile (< 1024px):** sem sidebar; bottom nav com 4-5 itens principais
- Nunca esconder a sidebar com CSS puro — usar a prop já existente em AppShell
- Padding de página: `p-4` (mobile) e `p-6` (desktop)
- Max-width do conteúdo: sem restrição de max-w (full width no container)

---

## 4. Grid e Espaçamento

### Sistema de grid
- **Colunas:** `grid-cols-1` (mobile), `grid-cols-2` (md), `grid-cols-3` (lg), `grid-cols-4` (xl)
- **Gap padrão:** `gap-4` (cards pequenos), `gap-6` (seções)
- Nunca misturar `gap` e `margin` para espaçamento de grid

### Espaçamento interno de componentes
| Componente | Padding |
|---|---|
| Card simples | `p-4` |
| Card com header | Header: `p-4 pb-2`, Body: `p-4 pt-0` |
| Modal/Dialog | `p-6` |
| Formulário | `space-y-4` |
| Botões em grupo | `gap-2` |
| Seções de página | `mb-6` |

### Hierarquia de título em página
```
h1: text-2xl font-bold        ← Título da página
h2: text-xl font-semibold     ← Seção da página
h3: text-base font-semibold   ← Título de card
p:  text-sm text-muted-foreground ← Descrição secundária
```

---

## 5. Cards

**Componente base:** `Card` de `apps/web/src/components/ui/card.tsx` (shadcn).

```tsx
<Card className="rounded-xl border bg-card">
  <CardHeader>
    <CardTitle>Título</CardTitle>
    <CardDescription>Descrição opcional</CardDescription>
  </CardHeader>
  <CardContent>
    {/* conteúdo */}
  </CardContent>
  <CardFooter>
    {/* ações opcionais */}
  </CardFooter>
</Card>
```

### Regras de card
- Sempre `rounded-xl` — nunca `rounded` ou `rounded-lg` em cards principais
- Sempre usar `border` — nunca card sem borda
- `bg-card` como fundo — nunca `bg-background` em card
- Cards de métricas (contadores do dashboard): ícone + label + número grande
- Cards de alerta/exceção: borda colorida (`border-l-4 border-destructive` para erro, `border-l-4 border-yellow-500` para aviso)

### Card de métrica (padrão)
```tsx
<Card className="rounded-xl border bg-card">
  <CardContent className="pt-6">
    <div className="flex items-center gap-3">
      <IconComponent className="h-5 w-5 text-muted-foreground" />
      <div>
        <p className="text-sm text-muted-foreground">Label</p>
        <p className="text-2xl font-bold">42</p>
      </div>
    </div>
  </CardContent>
</Card>
```

---

## 6. Tabelas

**Componente base:** `Table` de `apps/web/src/components/ui/table.tsx` (shadcn).

### Padrão de tabela
```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Coluna</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Valor</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

### Regras de tabela
- Tabela sempre dentro de um `Card` com `CardContent`
- Nunca usar `border-collapse` customizado — usar o padrão do componente
- Linhas zebradas: `odd:bg-muted/20` se necessário para densidade
- Colunas de ação (editar/excluir): última coluna, right-aligned, `w-[80px]`
- Colunas de badge/status: usar `Badge` component, não texto puro
- Linha vazia: renderizar `TableRow` com `colspan` e mensagem de estado vazio
- Paginação: componente `Pagination` de `apps/web/src/components/ui/pagination.tsx`
- Busca/filtro: acima da tabela, dentro do mesmo `Card`, antes do `CardContent`

---

## 7. Badges

**Componente base:** `Badge` de `apps/web/src/components/ui/badge.tsx`.

### Variantes padrão de badge por contexto
| Contexto | Variante | Cor |
|---|---|---|
| Status ativo / aprovado / sucesso | `default` | primary (azul) |
| Status devolvido / concluído | `secondary` | muted |
| Status pendente / aguardando | `outline` | border com texto |
| Status erro / crítico / vencido | `destructive` | vermelho |
| Status cancelado / inativo | `secondary` | cinza |
| Role admin | `default` | azul |
| Role armeiro/master | `secondary` | cinza |
| Role militar/usuario | `outline` | borda |

### Regras de badge
- Nunca criar badge customizado com `div` — usar o componente
- Nunca usar mais de 2 badges em uma célula de tabela
- Badge de contagem numérica: `rounded-full px-2 py-0.5 text-xs`
- Badges de role em tabela de usuários são obrigatórios (nunca texto puro para role)

---

## 8. Modais e Sheets

### Dialog (ação pontual)
**Componente:** `Dialog` de `apps/web/src/components/ui/dialog.tsx`

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button>Abrir</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Título</DialogTitle>
      <DialogDescription>Descrição</DialogDescription>
    </DialogHeader>
    {/* conteúdo */}
    <DialogFooter>
      <Button variant="outline">Cancelar</Button>
      <Button>Confirmar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Sheet (detalhes / forms laterais)
**Componente:** `Sheet` de `apps/web/src/components/ui/sheet.tsx`  
Usar para: detalhe de item, formulário de edição, preview de documento.

```tsx
<Sheet>
  <SheetTrigger asChild>...</SheetTrigger>
  <SheetContent side="right" className="w-[400px] sm:w-[540px]">
    <SheetHeader>
      <SheetTitle>Título</SheetTitle>
    </SheetHeader>
    {/* conteúdo */}
  </SheetContent>
</Sheet>
```

### Regras de modal
- Dialog: ações confirmação, forms simples (até 5 campos), confirmações destrutivas
- Sheet: detalhe de entidade, forms longos (6+ campos), visualização de documento
- Nunca criar modal com `div` + `fixed` + `z-index` — usar os componentes
- Confirmação destrutiva: sempre Dialog com botão `variant="destructive"` e texto de aviso
- Loading no modal: `Button` com `disabled` + `Loader2` dentro

---

## 9. Botões

**Componente:** `Button` de `apps/web/src/components/ui/button.tsx`.

### Variantes e quando usar
| Variante | Quando usar |
|---|---|
| `default` | Ação principal da tela (ex: "Emitir Cautela") |
| `secondary` | Ação secundária (ex: "Ver Histórico") |
| `outline` | Ação terciária ou cancelar em dialog |
| `destructive` | Ação irreversível (ex: "Excluir", "Revogar") |
| `ghost` | Ação contextual em tabela/lista |
| `link` | Navegação inline |

### Tamanhos
| Tamanho | Prop | Quando usar |
|---|---|---|
| Padrão | — | Botões em formulários e cards |
| Pequeno | `size="sm"` | Ações em linhas de tabela |
| Ícone | `size="icon"` | Botão com apenas ícone |

### Regras de botão
- Nunca mais de 1 botão `default` (primário) por seção visual
- Ordem em footer de dialog: `[Cancelar (outline)] [Confirmar (default ou destructive)]`
- Botão com loading: `disabled` + `<Loader2 className="mr-2 h-4 w-4 animate-spin" />` antes do texto
- Ícone + texto: `<IconComponent className="mr-2 h-4 w-4" />` antes do texto, não depois
- Nunca usar `onClick` sem feedback visual imediato

---

## 10. Estados de Loading

**Padrão obrigatório:** `Loader2` de `lucide-react` com `animate-spin`.

```tsx
// Loading de botão
<Button disabled>
  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  Processando...
</Button>

// Loading de página/seção
<div className="flex items-center justify-center p-8">
  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
</div>

// Loading de card de métrica
<Skeleton className="h-8 w-16" />  // Skeleton de apps/web/src/components/ui/skeleton.tsx
```

### Regras de loading
- Toda ação async deve mostrar loading state
- Nunca desabilitar botão sem mostrar que está carregando
- Skeleton preferido para dados que carregam na montagem do componente
- Loader2 preferido para ações iniciadas pelo usuário
- Nunca usar `setTimeout` fake de loading

---

## 11. Estados Vazios

Toda lista, tabela ou seção que pode não ter dados deve ter estado vazio explícito.

```tsx
// Padrão de empty state
<div className="flex flex-col items-center justify-center py-12 text-center">
  <IconComponent className="h-10 w-10 text-muted-foreground mb-4" />
  <h3 className="text-sm font-semibold">Nenhum registro</h3>
  <p className="text-sm text-muted-foreground mt-1">
    Texto explicando o que fazer para criar o primeiro registro.
  </p>
  <Button className="mt-4" size="sm">
    Criar primeiro registro
  </Button>
</div>
```

### Regras de estado vazio
- Ícone: sempre de `lucide-react`, `h-10 w-10 text-muted-foreground`
- Título: curto, direto ("Nenhuma cautela ativa")
- Subtexto: orientação de próximo passo, não apenas "vazio"
- CTA: opcional; incluir apenas se a ação é disponível para o role atual
- Nunca renderizar tabela com `tbody` vazio sem empty state dentro

---

## 12. Estados de Erro

```tsx
// Erro em formulário (campo)
<p className="text-sm text-destructive">
  {errors.campo?.message}
</p>

// Erro de API / toast
import { toast } from "sonner";
toast.error("Mensagem de erro", { description: "Detalhe opcional" });

// Erro de página (fetch falhou)
<Alert variant="destructive">
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Erro</AlertTitle>
  <AlertDescription>Não foi possível carregar os dados.</AlertDescription>
</Alert>
```

### Regras de estado de erro
- Erro de campo de formulário: abaixo do input, `text-sm text-destructive`
- Erro de API: toast com `toast.error()` de `sonner`
- Erro fatal de página: componente `Alert` com `variant="destructive"`
- Nunca exibir mensagem de erro técnica para o usuário (stack trace, SQL error, etc.)
- Mensagem de erro deve indicar o que falhou e o que o usuário pode fazer

---

## 13. Toasts

**Biblioteca:** `sonner` (já instalada em `apps/web/package.json`).  
**Provider:** já configurado em `apps/web/src/app/layout.tsx` ou `providers.tsx`.

```tsx
import { toast } from "sonner";

// Sucesso
toast.success("Cautela emitida com sucesso");

// Erro
toast.error("Falha ao emitir cautela", { description: "Tente novamente." });

// Info
toast.info("Sincronizando dados...");

// Warning
toast.warning("Prazo de devolução próximo");

// Promise (loading automático)
toast.promise(asyncFn(), {
  loading: "Processando...",
  success: "Concluído!",
  error: "Falha na operação",
});
```

### Regras de toast
- Duração padrão: 4 segundos (padrão do sonner)
- Nunca usar `alert()` nativo do browser
- Nunca usar toast para substituir estado de loading (usar loading state no botão)
- Máximo 1 toast por ação — não empilhar toasts de uma mesma operação
- Toast de erro deve ter descrição se o erro for ambíguo

---

## 14. Formulários

**Biblioteca:** `react-hook-form` + `@hookform/resolvers/zod` + `Zod`.  
**Componentes:** `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` de `apps/web/src/components/ui/form.tsx`.

```tsx
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
    <FormField
      control={form.control}
      name="campo"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Label</FormLabel>
          <FormControl>
            <Input placeholder="Placeholder" {...field} />
          </FormControl>
          <FormMessage />  {/* erro automático */}
        </FormItem>
      )}
    />
    <Button type="submit" disabled={form.formState.isSubmitting}>
      {form.formState.isSubmitting && (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      )}
      Salvar
    </Button>
  </form>
</Form>
```

### Regras de formulário
- Sempre usar `react-hook-form` + Zod — nunca `useState` para cada campo
- Schema Zod definido fora do componente (arquivo separado ou topo do arquivo)
- Labels sempre visíveis (nunca substituídas apenas por placeholder)
- `FormMessage` obrigatório em todo `FormField`
- Campos opcionais marcados com `(opcional)` no label, não com asterisco na obrigatoriedade
- Submit button sempre com loading state quando `isSubmitting`
- Após submit com sucesso: limpar formulário + toast + fechar dialog se aplicável

---

## 15. Filtros

Filtros ficam acima do conteúdo filtrado, sempre dentro do mesmo card.

```tsx
// Padrão de filtro de tabela
<div className="flex items-center gap-2 p-4 pb-0">
  <Input
    placeholder="Buscar..."
    className="max-w-xs"
    value={search}
    onChange={e => setSearch(e.target.value)}
  />
  <Select value={status} onValueChange={setStatus}>
    <SelectTrigger className="w-[180px]">
      <SelectValue placeholder="Status" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">Todos</SelectItem>
      <SelectItem value="ativo">Ativo</SelectItem>
    </SelectContent>
  </Select>
</div>
```

### Regras de filtro
- Input de busca: `max-w-xs`, debounce de 300ms para filtros de API
- Select de status: sempre com opção "Todos" como primeiro item
- Filtros de data: usar `date-fns` para formatação, nunca `toLocaleDateString`
- Nunca ter mais de 4 filtros visíveis ao mesmo tempo — usar "Mais filtros" se necessário
- Limpar filtros: botão "Limpar" pequeno (`size="sm" variant="ghost"`) ao lado dos filtros

---

## 16. Componentes de Dashboard

Cards de métricas do dashboard seguem padrão específico:

### Card de contagem (métrica numérica)
```tsx
<Card className="rounded-xl border bg-card">
  <CardContent className="pt-6">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Cautelas Ativas</p>
        <p className="text-3xl font-bold mt-1">24</p>
        <p className="text-xs text-muted-foreground mt-1">+3 desde ontem</p>
      </div>
      <div className="rounded-full p-2 bg-primary/10">
        <Shield className="h-5 w-5 text-primary" />
      </div>
    </div>
  </CardContent>
</Card>
```

### Card de alerta (exceção)
```tsx
<Card className="rounded-xl border border-l-4 border-l-destructive bg-card">
  <CardContent className="pt-6">
    <div className="flex items-center gap-3">
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <div>
        <p className="text-sm font-semibold">2 Passagens em Atraso</p>
        <p className="text-xs text-muted-foreground">Há mais de 2h sem assumção</p>
      </div>
    </div>
  </CardContent>
</Card>
```

### Regras de dashboard
- Cards de métrica normal: ícone no canto superior direito com fundo `bg-primary/10`
- Cards de exceção/alerta: borda esquerda colorida (`border-l-4`)
- Cards críticos (P0): `border-l-destructive`
- Cards de aviso (P1): `border-l-yellow-500`
- Cards de info: `border-l-blue-500`
- Gráficos: `recharts` (já presente em `apps/web/package.json`)
- Nunca criar gráfico com `canvas` puro

---

## 17. Responsividade

### Breakpoints Tailwind
| Nome | px | Dispositivo típico |
|---|---|---|
| `sm` | 640px | Tablet pequeno |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop (sidebar aparece) |
| `xl` | 1280px | Desktop large |

### Regras de responsividade
- **Mobile-first:** escrever CSS base para mobile, adicionar `md:` e `lg:` para expandir
- **Grid:** sempre começar com `grid-cols-1` e expandir: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
- **Tabelas:** em mobile (< 768px), considerar substituir por lista de cards
- **Bottom nav:** visível apenas em `< lg` — usar `lg:hidden` no componente
- **Sidebar:** visível apenas em `≥ lg` — usar `hidden lg:flex` no componente
- **Modais:** `max-h-[90vh] overflow-y-auto` em mobile para evitar corte

---

## 18. Acessibilidade

| Requisito | Como implementar |
|---|---|
| Contraste de texto | Usar tokens do design system — já calculados |
| Focus ring | Não remover `outline` — usar `ring` class do componente |
| Alt text em imagens | Obrigatório em toda `<img>` e `<Image>` |
| Aria labels | `aria-label` em botões que têm apenas ícone |
| Semântica HTML | `<button>` para ações, `<a>` para navegação — nunca `<div onClick>` |
| Form labels | Todo input tem `<label>` associado — usar `FormLabel` |
| Keyboard navigation | Tab order lógico em formulários e modais |
| Screen reader | `sr-only` para texto apenas para leitores de tela |

---

## 19. Linguagem Visual Institucional

### Tom dos textos de interface

| Contexto | Tom | Exemplo |
|---|---|---|
| Labels de campo | Formal, direto | "Matrícula", "Posto", "Material" |
| Botões de ação | Verbo + objeto direto | "Emitir Cautela", "Registrar Devolução", "Assinar" |
| Mensagens de sucesso | Confirmação direta | "Cautela emitida com sucesso" |
| Mensagens de erro | Direto, sem culpar o usuário | "Não foi possível emitir a cautela. Tente novamente." |
| Estados vazios | Orientação + próximo passo | "Nenhuma cautela ativa. Emita uma cautela para começar." |
| Títulos de página | Substantivo | "Cautelas", "Solicitações", "Passagem de Serviço" |
| Confirmação destrutiva | Formal + claro sobre consequência | "Esta ação não pode ser desfeita. O militar perderá acesso imediatamente." |

### Regras de linguagem
- **Nunca usar emojis em texto de UI** — usar ícones de `lucide-react`
- **Nunca usar gírias ou linguagem informal** — é sistema institucional militar
- **Usar "Militar" ou nome de posto** — nunca "usuário" na interface visível
- **"Armeiro" não "operador"** — usar terminologia do domínio
- **"Cautela" não "empréstimo"** — usar termo militar correto
- **"Passagem de Serviço" não "handover"** — não usar anglicismos na UI
- **Datas em pt-BR:** `dd/MM/yyyy HH:mm` — nunca formato ISO em UI visível

---

## 20. Regras Anti-Duplicação de Componentes

**Antes de criar qualquer componente, verificar:**

1. O componente existe em `apps/web/src/components/ui/`?
2. O componente existe em `apps/web/src/components/layout/`?
3. O componente existe em `apps/web/src/components/ssa/`, `cadete/` ou `dashboard/`?

**Se sim:** usar o componente existente. Adaptar via props, não criando cópia.

**Se não existe mas poderia ser genérico:** criar em `apps/web/src/components/ui/` e documentar.

**Se é específico do módulo:** criar em `apps/web/src/components/[modulo]/`.

### Componentes existentes que NUNCA devem ser duplicados

| Componente | Caminho | Substitui |
|---|---|---|
| `Button` | `ui/button.tsx` | `<div onClick>`, `<a onClick>`, botões customizados |
| `Card` + `CardContent` | `ui/card.tsx` | Containers com border custom |
| `Dialog` | `ui/dialog.tsx` | Modais com `fixed` + `z-index` custom |
| `Sheet` | `ui/sheet.tsx` | Drawers laterais custom |
| `Table` | `ui/table.tsx` | Tabelas com `<table>` puro |
| `Badge` | `ui/badge.tsx` | Spans com cor de background |
| `Input` | `ui/input.tsx` | Inputs com className pesado |
| `Select` | `ui/select.tsx` | Selects custom com JS |
| `Loader2` + `animate-spin` | lucide-react | Spinners custom |
| `Skeleton` | `ui/skeleton.tsx` | Placeholders de loading |
| `Alert` | `ui/alert.tsx` | Alertas com div colorida |
| `Sonner toast` | biblioteca | `alert()`, notificações custom |
| `AppShell` | `layout/app-shell.tsx` | Layouts customizados por módulo |

---

## 21. Regras de Reaproveitamento entre Módulos

- **Módulos diferentes usam os mesmos componentes base** — o card de cautela usa o mesmo `<Card>` que o card de inventário
- **Comportamentos similares compartilham lógica** — busca/filtro segue o mesmo padrão em todas as tabelas
- **Estilos de status** — a mesma lógica de cor de badge para "ativo/devolvido" vale para "emitida/assinada/concluída"
- **Hooks compartilhados** — `use-auth.ts` e `use-role.ts` usados em todos os módulos; nunca reimplementar
- **Formatação de datas** — centralizar em helper, nunca formatar inline em cada componente

---

## 22. Regras de Consistência entre Módulos

| O que deve ser igual | Em todos os módulos |
|---|---|
| Estrutura de página | Header (título + botão de ação primária) + filtros + tabela/lista |
| Padrão de listagem | Card com Table + paginação |
| Padrão de detalhe | Sheet lateral ou Dialog |
| Padrão de criação | Dialog com form ou página dedicada |
| Padrão de confirmação destrutiva | Dialog com texto de aviso + botão destructive |
| Padrão de loading | Skeleton no carregamento inicial, Loader2 em ações |
| Padrão de erro | Toast para ações, Alert para erros de carregamento |
| Terminologia de status | Usar os mesmos termos em badges e textos |

---

## 23. Regras para Novas Fases

Toda nova fase que entrega UI deve:

1. Verificar todos os componentes em `apps/web/src/components/ui/` antes de criar qualquer coisa
2. Seguir o padrão de estrutura de página de módulos existentes (ex: `/admin/arsenal`, `/reserva/saidas`)
3. Usar `AppShell` — nunca criar layout paralelo
4. Nunca criar estilos inline (`style={}`) para cor, border ou spacing
5. Nunca criar tema diferente para um módulo novo
6. Validar checklist visual (Seção 24) antes de considerar a fase completa

---

## 24. Checklist Visual Obrigatório

**Antes de encerrar qualquer fase com entrega de UI:**

### Layout e estrutura
- [ ] Página usa `AppShell` como wrapper
- [ ] Padding de página: `p-4` mobile, `p-6` desktop
- [ ] Sem layout customizado paralelo ao AppShell
- [ ] Grid responsivo: começa com `grid-cols-1`, expande com breakpoints

### Componentes
- [ ] Nenhum componente duplica o que existe em `ui/`
- [ ] Cards usam `rounded-xl border bg-card`
- [ ] Botões usam variantes corretas (default/secondary/outline/destructive/ghost)
- [ ] Badges usam o componente `Badge` com variante correta
- [ ] Tabelas usam o componente `Table` do shadcn
- [ ] Modais usam `Dialog` ou `Sheet` — nunca `div` com `fixed`

### Estados
- [ ] Todo botão async mostra loading state com `Loader2 animate-spin`
- [ ] Todo carregamento de dados tem skeleton ou loader
- [ ] Todo estado vazio tem ícone + título + subtexto + CTA opcional
- [ ] Todo erro de API mostra toast ou Alert adequado
- [ ] Todo erro de campo de formulário mostra `FormMessage`

### UX
- [ ] Ação principal acessível em ≤ 2 cliques
- [ ] Toasts de sucesso/erro em todas as ações
- [ ] Confirmação destrutiva com Dialog antes de deletar/revogar
- [ ] Mobile testado em 375px (iPhone SE viewport)

### Linguagem
- [ ] Nenhum emoji no texto de UI
- [ ] Terminologia do domínio militar usada (cautela, passagem, armeiro)
- [ ] Datas formatadas em `dd/MM/yyyy HH:mm`
- [ ] Labels formais, sem gírias

### Cores e tema
- [ ] Nenhum hexadecimal hardcoded — apenas tokens Tailwind
- [ ] Nenhuma cor fora dos tokens definidos
- [ ] Sem toggle de tema claro

---

*Guardrails gerados em: 2026-06-20*  
*Documento vinculante para todas as fases enterprise — consultar antes de criar qualquer UI*
