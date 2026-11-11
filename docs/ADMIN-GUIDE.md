# Admin guide

For the people who run SC Portal day to day from the home office. No code is involved: everything here happens in the browser.

## Signing in

1. Open the portal address and sign in with your username and password.
2. If you were given a one-time password, the portal asks you to choose your own straight away. Use at least 10 characters.
3. The **Admin console** is at the bottom of the left-hand menu, under "Home office". On a phone, tap **More** to open the menu.

You only see the admin sections your role allows. HR sees Overview, People, Content and Moderation. Administrators see everything.

Ten wrong passwords in 15 minutes locks sign-in for that username for 15 minutes.

## Roles in plain words

| Role | Who it is for | What they see | What they can do |
|---|---|---|---|
| Stylist | Everyone behind the chair | The company feed, their own salon and its numbers, promos, standards, training, checklists | Post, comment, react, give shout-outs, tick off checklists, open support tickets, ask HR a private question |
| Salon manager | The manager of one salon | Everything a stylist sees, plus full numbers and the team for their salon | Post announcements to their salon, sign off checklists, update salon alerts |
| District leader | Leader of a group of salons | Every salon in their district, with a district rollup | Post announcements to their district, work support tickets for their salons |
| HR | HR and payroll | All people and the private HR inbox. No sales dollars. | Add and manage people, answer HR questions, edit content, moderate posts |
| Leadership | Executives | Every salon and the company rollup | Post company announcements. Read only everywhere else. |
| Administrator | Home office owners of the portal | Everything | Everything, including goals, data import, settings and the audit log |

Two rules the portal enforces no matter what:

- A stylist or manager never sees another salon's dollar figures. They see its name, address, hours, manager, rank and pace percentage only.
- A private HR question is visible to the person who asked, HR and administrators. Managers, district leaders and leadership cannot read it.

## People

Admin console, **People**.

**Add one person.** Choose **Add a person**, enter their name, role and salon (stylists and salon managers need a salon). The portal shows a one-time password once. Copy it and give it to them privately. They pick their own password the first time they sign in.

**Add many people.** Choose **Import roster** and select a spreadsheet saved as CSV. It needs the columns `first_name`, `last_name` and `role`, plus `salon_number` for stylists and salon managers. Up to 300 people per file. Afterwards the portal lists each new username with its one-time password, and any rows it skipped with the reason. Copy the list before you close it.

**Change someone's role or salon.** Open the person from the list, change the field, **Save changes**. Moving a salon manager updates the salon's manager automatically.

**Someone leaves.** Set their status to **Inactive**. They are signed out at once and cannot sign in again. Their posts and history stay. Do not delete people.

**Someone is locked out or forgot their password.** Choose **Reset password**. It signs them out on every device and shows a new one-time password once.

Only an administrator can create or change Leadership and Administrator accounts.

## Announcements

Announcements are posted from the **Home** page, not from the admin console.

1. Click into the box at the top of the feed and choose **Announcement**.
2. Pick the audience: everyone, a district or a salon. Salon managers can announce to their own salon only. Market-wide announcements come from the home office.
3. Optionally pin it for 1 to 30 days. Pinned announcements sit at the top of the right-hand column.
4. Post. Each reader gets an **I've read this** button, and the announcement appears in their to-do list until they press it.

Shout-outs and wins are posted the same way by anyone. A shout-out names a teammate, a salon or a district and one of the company's recognition values.

## Content

Admin console, **Content**. Five tabs, all edited the same way: pick an item to change it, or add a new one. Changes are live as soon as you save.

| Tab | What it is | Notes |
|---|---|---|
| Promos | Current, upcoming and past offers | Set start and end dates. The portal sorts them into Running now, Coming up and Ended on its own. Add a photo with the upload button. |
| Standards and guides | Brand standards, product sheets, operations guides, policies, HR and handbook pages | Tick **requires acknowledgement** for anything people must confirm they have read. It then appears in each person's to-do list until they acknowledge it. |
| Videos | SC Tube | Each video needs a channel, a title and a link. |
| Events | The operations calendar | Inventory counts, promo starts, district calls, payroll cut-offs, training deadlines. |
| Checklists | Opening, closing and weekly lists | Edit the items or switch a list off. |

Writing a standard or policy: use short sections. A line starting with `#` becomes a heading, a line starting with `-` becomes a bullet, a line starting with `1.` becomes a numbered step, and `**text**` is bold.

The content loaded for the demo is sample material. Replace it with the company's own before the portal goes to the field.

## Goals

Admin console, **Goals** (administrators only).

The only goal the portal uses is each salon's monthly sales target, and it comes from the daily sales report. Pace to goal and "projected" use the report's own run rate, so the portal and the DSR always agree.

- The sales goal for each month is filled in automatically every time the sales load. You do not need to enter it.
- Product share and sales per hour have no goal. Each salon is compared with the company median instead.
- The screen still lets you type goals and **Save goals**, but the next sales load replaces the sales goal with the report's target and clears the other two columns. Treat this screen as read only while sales come from the reports.

## Sales numbers

Sales come from the daily DSR and DHR reports and load on their own at 11:20 AM and 3:20 PM Central. Every salon page shows when the numbers were last loaded and when they load next.

If a day looks wrong or stale, the report email was probably late. Tell the developer; they can run the load by hand. Administrators can also load a ledger file under Admin console, **Data import**, which shows how many rows were read and why any were skipped.

## Moderation

Admin console, **Moderation** (HR and administrators).

Anyone can report a post or comment from its menu. Reports arrive here with the reason.

- **Dismiss** if the post is fine. It stays up.
- **Remove** if it is not. The post disappears from the feed.

Either way the decision is recorded in the audit log with your name.

## HR inbox

In the left-hand menu, **HR inbox** (HR and administrators). Everyone else sees **Ask HR** in the same place.

- New questions arrive as open. The first HR person to reply picks it up.
- Reply in the thread and set the status: in progress, waiting, resolved or closed.
- The person who asked is notified of each reply.

These threads are private. Do not copy their content into posts, tickets or email.

## Support tickets

In the left-hand menu, **Support tickets**. Salons open tickets for IT, facilities, supplies or marketing. District leaders and administrators can reply and change the status. Leadership can read tickets but not update them.

## Audit log

Admin console, **Audit log** (administrators only).

A running record of sensitive actions: sign-ins and failed sign-ins, people added or changed, password resets, content edits, goals, data imports, moderation decisions, settings changes, announcements and uploads. Each row shows who, what, when and from which address. Use it to answer "who changed this?". Entries cannot be edited or removed from the portal.

## Settings

Admin console, **Settings** (administrators only).

- **Company name.**
- **Recognition values.** The list people choose from when giving a shout-out. Up to 12. Do not rename a value that has already been used.
- **Sample data switch.** See below.

## What "Preview" means

While the sample data switch is on, a small **Preview** marker shows in the top bar. Today it reads "live sales, sample team", which means:

| Real | Sample |
|---|---|
| The 51 salons, their addresses and phone numbers | Stylist and salon manager names |
| Districts and district leaders | Posts, shout-outs, tickets and HR questions |
| Leadership accounts | Promos, standards and policies |
| Daily sales, guests, hours, monthly sales targets and run rates, all by salon | |

There are no individual sales figures for stylists. The reports are by salon, so each person sees their salon's numbers, and the scoreboard ranks people by recognition received.

Turn the switch off only when the real roster is loaded, the sample activity is cleared and the content is the company's own.

## Using it on a phone

The portal installs like an app. On an iPhone, open it in Safari, tap Share, then **Add to Home Screen**. On Android, open the browser menu and choose **Install app**. The account menu also has an **Install the app** option with these steps.
