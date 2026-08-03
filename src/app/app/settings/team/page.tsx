import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import {
  inviteStaffAction,
  removeMemberAction,
  revokeInviteAction,
  setOwnerPropertiesAction,
  updateMemberRoleAction,
} from "@/actions/team";
import { formatDate, formatDateTime } from "@/lib/dates";
import { appUrl } from "@/lib/email";
import { Badge, Banner, Card, EmptyState, Table } from "@/components/ui";
import { InviteStaffForm } from "../_components/invite-staff-form";
import { MemberRow } from "../_components/member-row";
import { InviteRow } from "../_components/invite-row";
import { OwnerAccessForm } from "../_components/owner-access-form";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireStaff();
  const isAdmin = ctx.role === "ADMIN";

  const [members, invitations, properties, ownerLinks] = await Promise.all([
    db.user.findMany({
      where: { organizationId: ctx.organizationId, role: { not: "TENANT" } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    db.invitation.findMany({
      where: { organizationId: ctx.organizationId, acceptedAt: null, tenantId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, role: true, token: true, expiresAt: true },
    }),
    db.property.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.propertyOwner.findMany({
      where: { property: { organizationId: ctx.organizationId } },
      select: { userId: true, propertyId: true },
    }),
  ]);

  const owners = members.filter((m) => m.role === "OWNER");
  const showInviteLinks = !process.env.RESEND_API_KEY;

  return (
    <div className="space-y-6">
      {!isAdmin ? (
        <Banner tone="info">Only admins can invite or change team members.</Banner>
      ) : null}

      {isAdmin ? (
        <Card
          title="Invite someone"
          description="Staff manage day to day. Admins also control settings and rent collection. Owners get read-only financials for the properties you pick."
        >
          <InviteStaffForm action={inviteStaffAction} />
        </Card>
      ) : null}

      <Card title="Team" padded={false}>
        <Table
          head={
            <tr>
              <th className="th">Name</th>
              <th className="th">Role</th>
              <th className="th">Last active</th>
              {isAdmin ? <th className="th"></th> : null}
            </tr>
          }
        >
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={{
                ...member,
                lastLoginAt: member.lastLoginAt ? formatDateTime(member.lastLoginAt) : null,
              }}
              isSelf={member.id === ctx.id}
              canManage={isAdmin}
              updateRoleAction={updateMemberRoleAction.bind(null, member.id)}
              removeAction={removeMemberAction.bind(null, member.id)}
            />
          ))}
        </Table>
      </Card>

      {invitations.length > 0 ? (
        <Card
          title="Pending invitations"
          description={
            showInviteLinks
              ? "No email provider is configured, so copy the link and send it yourself."
              : undefined
          }
          padded={false}
        >
          <Table
            head={
              <tr>
                <th className="th">Invited</th>
                <th className="th">Role</th>
                <th className="th">Expires</th>
                <th className="th"></th>
              </tr>
            }
          >
            {invitations.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={{
                  id: invite.id,
                  name: invite.name,
                  email: invite.email,
                  role: invite.role,
                  expires: formatDate(invite.expiresAt),
                  link: showInviteLinks ? appUrl(`/invite/${invite.token}`) : null,
                }}
                canManage={isAdmin}
                revokeAction={revokeInviteAction.bind(null, invite.id)}
              />
            ))}
          </Table>
        </Card>
      ) : null}

      {owners.length > 0 ? (
        <Card
          title="Owner access"
          description="Owners only see the properties you tick here — and only the financial summary, never tenant contact details."
        >
          {properties.length === 0 ? (
            <EmptyState
              title="No properties to share yet"
              description="Add a property first, then come back to grant access."
            />
          ) : (
            <div className="space-y-6">
              {owners.map((owner) => (
                <div key={owner.id} className="border-t border-slate-100 pt-5 first:border-0 first:pt-0">
                  <p className="mb-3 text-sm font-medium text-slate-900">
                    {owner.name} <Badge tone="slate">{owner.email}</Badge>
                  </p>
                  <OwnerAccessForm
                    action={setOwnerPropertiesAction.bind(null, owner.id)}
                    properties={properties}
                    selectedIds={ownerLinks
                      .filter((l) => l.userId === owner.id)
                      .map((l) => l.propertyId)}
                    readOnly={!isAdmin}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
