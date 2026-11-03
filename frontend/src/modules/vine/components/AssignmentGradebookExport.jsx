import "./AssignmentGradebookExport.css";

const formatAssignmentOption = (assignment) => {
  const title = String(assignment?.title || "Untitled assignment").trim();
  if (!assignment?.due_at) return title;
  const dueDate = new Date(assignment.due_at);
  if (Number.isNaN(dueDate.getTime())) return title;
  return `${title} — ${dueDate.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
};

export default function AssignmentGradebookExport({
  assignments,
  isExporting,
  onExport,
  onSelectionChange,
  selectedAssignmentId,
}) {
  return (
    <div className="assignment-gradebook-export">
      <label>
        <span>PDF gradebook</span>
        <select
          value={selectedAssignmentId}
          onChange={(event) => onSelectionChange(event.target.value)}
          disabled={isExporting || assignments.length === 0 || !selectedAssignmentId}
          aria-label="Assignment to include in gradebook PDF"
        >
          <option value="all">All assignments — full archive</option>
          {assignments.map((assignment) => (
            <option key={assignment.id} value={String(assignment.id)}>
              {formatAssignmentOption(assignment)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={onExport}
        disabled={isExporting || assignments.length === 0 || !selectedAssignmentId}
      >
        {isExporting ? "Preparing PDF..." : "Export selected PDF"}
      </button>
    </div>
  );
}
