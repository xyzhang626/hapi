import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

import remarkDisableIndentedCode from '@/lib/remark-disable-indented-code'
import remarkStripCjkAutolink from '@/lib/remark-strip-cjk-autolink'
import { cn } from '@/lib/utils'

type StandaloneMarkdownProps = {
    content: string
    className?: string
}

function Pre(props: ComponentPropsWithoutRef<'pre'>) {
    return (
        <pre
            {...props}
            className={cn(
                'aui-md-pre my-2 max-w-full overflow-x-auto rounded-md bg-[var(--app-code-bg)] p-2 text-sm',
                props.className
            )}
        />
    )
}

function Code(props: ComponentPropsWithoutRef<'code'>) {
    return (
        <code
            {...props}
            className={cn(
                'aui-md-code break-words rounded bg-[var(--app-inline-code-bg)] px-[0.3em] py-[0.1em] font-mono text-[0.9em]',
                props.className
            )}
        />
    )
}

const components: Components = {
    a(props) {
        const rel = props.target === '_blank' ? (props.rel ?? 'noreferrer') : props.rel
        return <a {...props} rel={rel} className={cn('aui-md-a text-[var(--app-link)] underline', props.className)} />
    },
    p(props) {
        return <p {...props} className={cn('aui-md-p leading-relaxed', props.className)} />
    },
    strong(props) {
        return <strong {...props} className={cn('aui-md-strong font-semibold', props.className)} />
    },
    em(props) {
        return <em {...props} className={cn('aui-md-em italic', props.className)} />
    },
    blockquote(props) {
        return (
            <blockquote
                {...props}
                className={cn('aui-md-blockquote border-l-4 border-[var(--app-hint)] pl-3 opacity-85', props.className)}
            />
        )
    },
    ul(props) {
        return <ul {...props} className={cn('aui-md-ul list-disc pl-6', props.className)} />
    },
    ol(props) {
        return <ol {...props} className={cn('aui-md-ol list-decimal pl-6', props.className)} />
    },
    li(props) {
        return <li {...props} className={cn('aui-md-li', props.className)} />
    },
    hr(props) {
        return <hr {...props} className={cn('aui-md-hr border-[var(--app-divider)]', props.className)} />
    },
    table(props) {
        return (
            <div className="aui-md-table-wrapper max-w-full overflow-x-auto">
                <table {...props} className={cn('aui-md-table w-full border-collapse', props.className)} />
            </div>
        )
    },
    th(props) {
        return (
            <th
                {...props}
                className={cn(
                    'aui-md-th border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1 text-left font-semibold',
                    props.className
                )}
            />
        )
    },
    td(props) {
        return <td {...props} className={cn('aui-md-td border border-[var(--app-border)] px-2 py-1', props.className)} />
    },
    h1(props) {
        return <h1 {...props} className={cn('aui-md-h1 mt-3 text-base font-semibold', props.className)} />
    },
    h2(props) {
        return <h2 {...props} className={cn('aui-md-h2 mt-3 text-base font-semibold', props.className)} />
    },
    h3(props) {
        return <h3 {...props} className={cn('aui-md-h3 mt-2 text-base font-semibold', props.className)} />
    },
    h4(props) {
        return <h4 {...props} className={cn('aui-md-h4 mt-2 text-base font-semibold', props.className)} />
    },
    h5(props) {
        return <h5 {...props} className={cn('aui-md-h5 mt-2 text-base font-semibold', props.className)} />
    },
    h6(props) {
        return <h6 {...props} className={cn('aui-md-h6 mt-2 text-base font-semibold', props.className)} />
    },
    pre: Pre,
    code: Code,
    img(props) {
        return <img {...props} className={cn('aui-md-img max-w-full rounded', props.className)} />
    },
}

export function StandaloneMarkdown(props: StandaloneMarkdownProps) {
    return (
        <div className={cn('aui-md min-w-0 max-w-full break-words text-base', props.className)}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkStripCjkAutolink, remarkMath, remarkDisableIndentedCode]}
                rehypePlugins={[rehypeKatex]}
                components={components}
            >
                {props.content}
            </ReactMarkdown>
        </div>
    )
}
