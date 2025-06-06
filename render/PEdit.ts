import { Context } from "hono";
import { html, raw } from "hono/html";
import { Header, Footer } from "./Common";
import { PEditProps } from "../src/post";

export function PEdit(a: Context, z: PEditProps) {
    z.head_external = raw(`
        <link href="/quill.snow.css" rel="stylesheet" />
        <style>
            .ql-toolbar.ql-snow {
                border-top-left-radius: 0.5rem;
                border-top-right-radius: 0.5rem;
                background: #f8f9fa;
                border-color: #e2e8f0;
            }
            .ql-container.ql-snow {
                border-bottom-left-radius: 0.5rem;
                border-bottom-right-radius: 0.5rem;
                border-color: #e2e8f0;
            }
            .ql-editor,.ql-container {
                height: 520px;
            }
            .ql-container {
                padding: 0;
            }
            .ql-editor img {
                padding: 4px 0;
            }
        </style>
    `)
    return html`
${Header(a, z)}

<div class="container mx-auto max-w-5xl">
    <div class="card bg-base-100 shadow-lg">
        <div name="content">${z.content}</div>
    </div>
    <div class="flex justify-center mt-4">
        <button class="btn join-item btn-primary" onclick="post(${z.eid})">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            ${z.title}
        </button>
    </div>
</div>

<script src="/quill.js"></script>
<script>
    const quill = new Quill('[name="content"]', {
        modules: {
            toolbar: [{ 'header': [1, 2, 3, 4, 5, 6, false] }, 'bold', 'italic', 'underline', 'code-block', 'link', 'image', 'clean']
        },
        theme: 'snow',
        placeholder: '请输入内容...'
    });
    const toolbar = quill.getModule('toolbar');
    toolbar.addHandler('image', upload);
</script>

${Footer(a, z)}
`;
}
