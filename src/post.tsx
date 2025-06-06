import { Context } from "hono";
import { raw } from "hono/html";
import { and, desc, eq, gt, inArray, ne, sql, count, lte, asc, getTableColumns } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { DB, Post, User, Props, Count } from "./base";
import { Auth, Config, Pagination, HTMLFilter, IsAdmin, HTMLText } from "./core";
import { mAdd, mDel } from "./message";
import { PEdit } from "../render/PEdit";
import { PList } from "../render/PList";

export interface PEditProps extends Props {
    eid: number,
    content: string,
}

export interface PListProps extends Props {
    page: number
    pagination: number[]
    data: (typeof Post.$inferSelect & {
        name: string | null;
        credits: number | null;
        gid: number | null;
        quote_content: string | null;
        quote_name: string | null;
    })[]
}

export async function pEdit(a: Context) {
    const i = await Auth(a)
    if (!i) { return a.text('401', 401) }
    const time = Math.floor(Date.now() / 1000)
    const eid = parseInt(a.req.param('eid') ?? '0')
    let title = ""
    let content = ''
    if (eid < 0) {
        title = "编辑"
        const post = (await DB(a)
            .select()
            .from(Post)
            .where(and(
                eq(Post.pid, -eid),
                inArray(Post.type, [0, 1]), // 已删除的内容不能编辑
                IsAdmin(i, undefined, eq(Post.uid, i.uid)), // 管理和作者都能编辑
                IsAdmin(i, undefined, gt(sql`${Post.time} + 604800`, time)), // 7天后禁止编辑
            ))
        )?.[0]
        if (!post) { return a.text('403', 403) }
        content = raw(post.content) ?? ''
    } else {
        title = "发帖"
    }
    const thread_lock = true;
    return a.html(PEdit(a, { i, title, eid, content, thread_lock }));
}

export async function pSave(a: Context) {
    const i = await Auth(a)
    if (!i) { return a.text('401', 401) }
    const time = Math.floor(Date.now() / 1000)
    const body = await a.req.formData()
    const eid = parseInt(a.req.param('eid') ?? '0')
    const raw = body.get('content')?.toString() ?? ''
    if (eid < 0) { // 编辑
        const [content, length] = await HTMLFilter(raw)
        if (length < 3) { return a.text('content_short', 422) }
        const post = (await DB(a)
            .update(Post)
            .set({
                content: content,
            })
            .where(and(
                eq(Post.pid, -eid),
                inArray(Post.type, [0, 1]), // 已删除的内容不能编辑
                IsAdmin(i, undefined, eq(Post.uid, i.uid)), // 管理和作者都能编辑
                IsAdmin(i, undefined, gt(sql`${Post.time} + 604800`, time)), // 7天后禁止编辑
            ))
            .returning({ pid: Post.pid })
        )?.[0]
        if (!post.pid) { return a.text('403', 403) }
        return a.text('ok')
    } else if (eid > 0) { // 回复
        if (time - i.last_time < 60) { return a.text('too_fast', 403) } // 防止频繁发帖
        const Thread = alias(Post, 'Thread')
        const quote = (await DB(a)
            .select({
                pid: Post.pid,
                uid: Post.uid,
                tid: Thread.pid,
                last_time: Thread.sort,
            })
            .from(Post)
            .where(and(
                eq(Post.pid, eid),
                inArray(Post.type, [0, 1]), // 已删除的内容不能回复
            ))
            .leftJoin(Thread, eq(Thread.pid, sql`CASE WHEN ${Post.tid} = 0 THEN ${Post.pid} ELSE ${Post.tid} END`))
        )?.[0]
        if (!quote || quote.tid === null || quote.last_time === null) { return a.text('not_found', 403) } // 被回复帖子或主题不存在
        if (time > quote.last_time + 604800) { return a.text('too_old', 429) } // 7天后禁止回复
        const [content, length] = await HTMLFilter(raw)
        if (length < 3) { return a.text('content_short', 422) }
        const res = (await DB(a).batch([
            DB(a)
                .insert(Post)
                .values({
                    tid: quote.tid,
                    uid: i.uid,
                    sort: time,
                    clue: quote.pid,
                    time,
                    content,
                })
                .returning({ pid: Post.pid })
            ,
            DB(a)
                .update(Post)
                .set({
                    sort: time,
                    clue: i.uid,
                })
                .where(eq(Post.pid, quote.tid))
            ,
            DB(a)
                .insert(Count)
                .values([
                    { uid_tid: quote.tid, quantity: 1 },
                ])
                .onConflictDoUpdate({
                    target: Count.uid_tid,
                    set: { quantity: sql`${Count.quantity} + 1` }
                })
            ,
            DB(a)
                .update(User)
                .set({
                    credits: sql`${User.credits} + 1`,
                    golds: sql`${User.golds} + 1`,
                    last_time: time,
                })
                .where(eq(User.uid, i.uid))
            ,
        ]))[0][0]
        if (!res.pid) { return a.text('db execute failed', 403) }
        // 回复通知开始 如果回复的不是自己
        if (i.uid != quote.uid) {
            await mAdd(a, quote.uid, 1, res.pid)
        }
        // 回复通知结束
        return a.text('ok') //! 返回tid/pid和posts数量
    } else { // 发帖
        if (time - i.last_time < 60) { return a.text('too_fast', 403) } // 防止频繁发帖
        const [content, length] = await HTMLFilter(raw)
        if (length < 3) { return a.text('content_short', 422) }
        const res = (await DB(a).batch([
            // last_insert_rowid() = post.pid
            DB(a)
                .insert(Post)
                .values({
                    uid: i.uid,
                    sort: time,
                    time,
                    content,
                }).returning({ pid: Post.pid })
            ,
            DB(a)
                .insert(Count)
                .values([
                    { uid_tid: -i.uid, quantity: 1 },
                    { uid_tid: 0, quantity: 1 },
                ])
                .onConflictDoUpdate({
                    target: Count.uid_tid,
                    set: { quantity: sql`${Count.quantity} + 1` }
                })
            ,
            DB(a)
                .update(User)
                .set({
                    credits: sql`${User.credits} + 2`,
                    golds: sql`${User.golds} + 2`,
                    last_time: time,
                })
                .where(eq(User.uid, i.uid))
            ,
        ]))[0][0]
        if (!res.pid) { return a.text('db execute failed', 403) }
        return a.text(String(res.pid))
    }
}

export async function pOmit(a: Context) {
    const i = await Auth(a)
    if (!i) { return a.text('401', 401) }
    const pid = -parseInt(a.req.param('eid') ?? '0')
    const post = (await DB(a)
        .select({
            pid: Post.pid,
            uid: Post.uid,
            tid: Post.tid,
            clue: Post.clue,
        })
        .from(Post)
        .where(and(
            eq(Post.pid, pid),
            IsAdmin(i, undefined, eq(Post.uid, i.uid)), // 管理和作者都能删除
        ))
    )?.[0]
    // 如果无权限或帖子不存在则报错
    if (!post) { return a.text('410:gone', 410) }
    if (!post.tid) {
        // 如果删的是Thread
        await DB(a).batch([
            DB(a)
                .update(Post)
                .set({
                    type: 3,
                })
                .where(eq(Post.pid, post.pid))
            ,
            DB(a)
                .update(Count)
                .set({
                    quantity: sql`${Count.quantity} - 1`,
                })
                .where(inArray(Count.uid_tid, [post.uid, 0]))
            ,
            DB(a)
                .update(User)
                .set({
                    credits: sql`${User.credits} - 2`,
                    golds: sql`${User.golds} - 2`,
                })
                .where(eq(User.uid, post.uid))
            ,
        ])
        // 回复通知开始
        const QuotePost = alias(Post, 'QuotePost')
        // 找出该主题所有帖子 以及它们引用的帖子 删除回复通知
        const postArr = await DB(a)
            .select({
                pid: Post.pid, // 回复的ID
                quote_uid: QuotePost.uid, // 被回复的UID
            })
            .from(Post)
            .where(and(
                inArray(Post.type, [0, 1, 2, 3]),
                eq(Post.tid, post.pid), // 此处 post.pid 就是 tid
                ne(Post.uid, QuotePost.uid),
            ))
            .leftJoin(QuotePost, eq(QuotePost.pid, Post.clue))
        postArr.forEach(async function (row) {
            if (row.quote_uid) {
                // 未读 已读 消息都删
                await mDel(a, row.quote_uid, [-1, 1], row.pid)
            }
        })
        // 回复通知结束
    } else {
        // 如果删的是Post 如果所有回复都删了会返回null
        const last = DB(a).$with('last').as(
            DB(a)
                .select({
                    uid: Post.uid,
                    time: Post.time,
                })
                .from(Post)
                .where(and(
                    // type
                    eq(Post.type, 0),
                    // tid
                    eq(Post.tid, post.tid),
                ))
                .orderBy(desc(Post.type), desc(Post.tid), desc(Post.sort))
                .limit(1)
        )
        await DB(a).batch([
            DB(a)
                .update(Post)
                .set({
                    type: 3,
                })
                .where(eq(Post.pid, post.pid))
            ,
            DB(a)
                .with(last)
                .update(Post)
                .set({
                    sort: sql`COALESCE((SELECT time FROM ${last}),${Post.time})`,
                    clue: sql`(SELECT COALESCE(uid,0) FROM ${last})`,
                })
                .where(eq(Post.pid, post.tid)) // 更新thread
            ,
            DB(a)
                .update(Count)
                .set({
                    quantity: sql`${Count.quantity} - 1`,
                })
                .where(eq(Count.uid_tid, post.tid))
            ,
            DB(a)
                .update(User)
                .set({
                    credits: sql`${User.credits} - 1`,
                    golds: sql`${User.golds} - 1`,
                })
                .where(eq(User.uid, post.uid))
            ,
        ])
        // 回复通知开始
        const quote = (await DB(a)
            .select()
            .from(Post)
            .where(eq(Post.pid, post.clue))
        )?.[0]
        // 如果存在被回复帖 且回复的不是自己
        if (quote && post.uid != quote.uid) {
            // 未读 已读 消息都删
            await mDel(a, quote.uid, [-1, 1], post.pid)
        }
        // 回复通知结束
    }
    return a.text('ok')
}

export async function pList(a: Context) {
    const i = await Auth(a)
    const tid = parseInt(a.req.param('tid'))
    const QuotePost = alias(Post, 'QuotePost')
    const QuoteUser = alias(User, 'QuoteUser')
    const thread = (await DB(a)
        .select({
            ...getTableColumns(Post),
            name: User.name,
            credits: User.credits,
            gid: User.gid,
            quote_content: sql<string>`''`,
            quote_name: sql<string>`''`,
            count: Count.quantity,
        })
        .from(Post)
        .where(and(
            eq(Post.pid, tid),
            inArray(Post.type, [0, 1]),
        ))
        .leftJoin(User, eq(Post.uid, User.uid))
        .leftJoin(Count, eq(Count.uid_tid, tid))
    )?.[0]
    if (!thread) { return a.notFound() }
    const page = parseInt(a.req.param('page') ?? '0') || 1
    const page_size_p = await Config.get<number>(a, 'page_size_p') || 20
    const data = [thread, ...await DB(a)
        .select({
            ...getTableColumns(Post),
            name: User.name,
            credits: User.credits,
            gid: User.gid,
            quote_content: QuotePost.content,
            quote_name: QuoteUser.name,
            count: sql<number>`0`,
        })
        .from(Post)
        .where(and(
            // type
            eq(Post.type, 0),
            // tid
            eq(Post.tid, tid),
        ))
        .leftJoin(User, eq(Post.uid, User.uid))
        .leftJoin(QuotePost, and(ne(Post.clue, Post.tid), eq(QuotePost.pid, Post.clue), inArray(QuotePost.type, [0, 1])))
        .leftJoin(QuoteUser, eq(QuoteUser.uid, QuotePost.uid))
        .orderBy(asc(Post.type), asc(Post.tid), asc(Post.sort))
        .offset((page - 1) * page_size_p)
        .limit(page_size_p)
    ]
    const pagination = Pagination(page_size_p, thread.count ?? 0, page, 2)
    const title = await HTMLText(thread.content, 140, true)
    const thread_lock = Math.floor(Date.now() / 1000) > (thread.sort + 604800)
    return a.html(PList(a, { i, page, pagination, data, title, thread_lock }))
}

export async function pJump(a: Context) {
    const tid = parseInt(a.req.query('tid') ?? '0')
    const time = parseInt(a.req.query('time') ?? '0')
    if (!tid || !time) { return a.redirect('/') }
    const page_size_p = await Config.get<number>(a, 'page_size_p') || 20
    const data = (await DB(a)
        .select({ count: count() })
        .from(Post)
        .where(and(
            // type
            eq(Post.type, 0),
            // tid
            eq(Post.tid, tid),
            // time
            lte(Post.sort, time),
        ))
        .orderBy(asc(Post.type), asc(Post.tid), asc(Post.sort))
    )?.[0]
    const page = Math.ceil(data.count / page_size_p)
    return a.redirect('/t/' + tid + '/' + page + '?' + time, 301)
}
