import { Context } from "hono";
import { and, desc, eq, lt } from 'drizzle-orm';
import { alias } from "drizzle-orm/sqlite-core";
import { DB, Post, User } from "./base";
import { Auth, HTMLText } from "./core";
import { MList } from "../render/MList";

// 清空消息
export async function mClear(a: Context) {
    const i = await Auth(a)
    if (!i) { return a.text('401', 401) }
    try {
        await DB(a)
            .update(User)
            .set({
                last_read: a.get('time'),
            })
            .where(
                eq(User.uid, i.uid),
            );
    } catch (error) {
        console.error('切换失败:', error);
    }
    return a.json('ok')
}

export async function mData(a: Context) {
    const i = await Auth(a)
    if (!i) { return a.text('401', 401) }
    const sort_time = parseInt(a.req.query('sort_time') ?? '0')
    const QuotePost = alias(Post, 'QuotePost')
    const data = await DB(a)
        .select({
            post_pid: Post.pid,
            post_tid: Post.tid,
            post_time: Post.time,
            post_content: Post.content,
            post_uid: User.uid,
            post_name: User.name,
            quote_pid: QuotePost.pid,
            quote_content: QuotePost.content,
        })
        .from(Post)
        .where(and(
            eq(Post.type, 0),
            eq(Post.quote_uid, i.uid),
            sort_time ? lt(Post.sort_time, sort_time) : undefined,
        ))
        .leftJoin(User, eq(User.uid, Post.uid))
        .leftJoin(QuotePost, eq(QuotePost.pid, Post.relate_id))
        .orderBy(desc(Post.type), desc(Post.quote_uid), desc(Post.sort_time))
        .limit(10)
    await Promise.all(data.map(async function (row) {
        row.quote_content = await HTMLText(row.quote_content, 300);
        row.post_content = await HTMLText(row.post_content, 300);
    }))
    return a.json(data)
}

export async function mList(a: Context) {
    const i = await Auth(a)
    if (!i) {
        // 重定向到登录页面而不是返回401
        return a.redirect('/auth');
    }
    const title = '消息'
    return a.html(MList(a, { i, title }));
}
