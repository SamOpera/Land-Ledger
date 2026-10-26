// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LandLedger
/// @author Samson Olakeye (SamOpera), https://samsonolakeye.com
/// @notice An on-chain land title registry. A land bureau approves survey plans and
/// appoints registrars; registrars register parcels against approved plans and approve
/// transfers; owners start transfers of their own land. Anyone can verify a title.
/// @dev Design choices:
///  - One plan, one parcel: each approved survey plan can be registered exactly once,
///    which is what stops the same land being sold or registered twice.
///  - One transfer at a time: a parcel with a pending transfer or an open dispute
///    cannot be offered again until that is resolved.
///  - Two keys to move land: the owner proposes, a registrar approves. Neither can
///    move land alone.
///  - No personal data on-chain: a parcel stores a hash of its title documents, kept
///    off-chain. Names, phone numbers and IDs never touch the public chain.
///  - Every change emits an event, so a title's full history can be read from logs.
contract LandLedger {
    enum PlanStatus {
        None,
        Approved,
        Used
    }

    struct Parcel {
        address owner;
        bytes32 surveyPlan; // keccak256 of the survey plan number, e.g. "LA/1234/2024"
        bytes32 documentHash; // keccak256 of the title documents, stored off-chain
        string location; // e.g. "Plot 12, Block C, Lekki Phase 1, Lagos"
        uint64 areaSqm;
        uint64 registeredAt;
        address pendingBuyer; // non-zero while a transfer is waiting for approval
        bool disputed;
        uint32 transfers;
    }

    address public immutable bureau;
    uint256 public parcelCount;

    mapping(address => bool) public isRegistrar;
    mapping(bytes32 => PlanStatus) public planStatus;
    mapping(bytes32 => uint256) public parcelOfPlan;
    mapping(uint256 => Parcel) private _parcels;

    event RegistrarSet(address indexed registrar, bool active);
    event SurveyPlanApproved(bytes32 indexed surveyPlan);
    event ParcelRegistered(
        uint256 indexed id,
        address indexed owner,
        bytes32 indexed surveyPlan,
        string location,
        uint64 areaSqm,
        bytes32 documentHash,
        address registrar
    );
    event TransferProposed(uint256 indexed id, address indexed from, address indexed to);
    event TransferCancelled(uint256 indexed id);
    event TransferApproved(uint256 indexed id, address indexed from, address indexed to, address registrar);
    event DisputeFlagged(uint256 indexed id, string reason, address registrar);
    event DisputeCleared(uint256 indexed id, string resolution, address registrar);

    error NotBureau();
    error NotRegistrar();
    error NotOwner();
    error ZeroAddress();
    error EmptyValue();
    error PlanNotApproved(PlanStatus current);
    error PlanAlreadyKnown();
    error UnknownParcel();
    error TransferPending();
    error NoPendingTransfer();
    error UnderDispute();
    error NotDisputed();
    error SelfTransfer();

    modifier onlyBureau() {
        if (msg.sender != bureau) revert NotBureau();
        _;
    }

    modifier onlyRegistrar() {
        if (!isRegistrar[msg.sender]) revert NotRegistrar();
        _;
    }

    constructor() {
        bureau = msg.sender;
    }

    // ----------------------------------------------------------------- views

    function getParcel(uint256 id) external view returns (Parcel memory) {
        return _get(id);
    }

    /// @notice What a buyer checks before paying: who owns it, and whether it can be sold now.
    function verify(uint256 id)
        external
        view
        returns (address owner, bool disputed, bool transferPending, uint32 transfers)
    {
        Parcel storage p = _get(id);
        return (p.owner, p.disputed, p.pendingBuyer != address(0), p.transfers);
    }

    // ---------------------------------------------------------------- bureau

    /// @notice Appoint or remove a registrar. Only the bureau can do this.
    function setRegistrar(address registrar, bool active) external onlyBureau {
        if (registrar == address(0)) revert ZeroAddress();
        isRegistrar[registrar] = active;
        emit RegistrarSet(registrar, active);
    }

    /// @notice Approve a survey plan so a parcel can be registered against it, once.
    function approveSurveyPlan(bytes32 surveyPlan) external onlyBureau {
        if (surveyPlan == bytes32(0)) revert EmptyValue();
        if (planStatus[surveyPlan] != PlanStatus.None) revert PlanAlreadyKnown();
        planStatus[surveyPlan] = PlanStatus.Approved;
        emit SurveyPlanApproved(surveyPlan);
    }

    // ------------------------------------------------------------- registrar

    /// @notice Register a parcel against an approved, unused survey plan.
    function registerParcel(
        address owner,
        bytes32 surveyPlan,
        bytes32 documentHash,
        string calldata location,
        uint64 areaSqm
    ) external onlyRegistrar returns (uint256 id) {
        if (owner == address(0)) revert ZeroAddress();
        if (documentHash == bytes32(0) || bytes(location).length == 0 || areaSqm == 0) revert EmptyValue();
        PlanStatus status = planStatus[surveyPlan];
        if (status != PlanStatus.Approved) revert PlanNotApproved(status);

        planStatus[surveyPlan] = PlanStatus.Used;
        id = ++parcelCount;
        parcelOfPlan[surveyPlan] = id;
        _parcels[id] = Parcel({
            owner: owner,
            surveyPlan: surveyPlan,
            documentHash: documentHash,
            location: location,
            areaSqm: areaSqm,
            registeredAt: uint64(block.timestamp),
            pendingBuyer: address(0),
            disputed: false,
            transfers: 0
        });
        emit ParcelRegistered(id, owner, surveyPlan, location, areaSqm, documentHash, msg.sender);
    }

    /// @notice Complete a transfer the owner proposed.
    function approveTransfer(uint256 id) external onlyRegistrar {
        Parcel storage p = _get(id);
        address buyer = p.pendingBuyer;
        if (buyer == address(0)) revert NoPendingTransfer();
        if (p.disputed) revert UnderDispute();
        address seller = p.owner;
        p.owner = buyer;
        p.pendingBuyer = address(0);
        p.transfers += 1;
        emit TransferApproved(id, seller, buyer, msg.sender);
    }

    /// @notice Freeze a parcel while a claim against it is investigated.
    function flagDispute(uint256 id, string calldata reason) external onlyRegistrar {
        Parcel storage p = _get(id);
        if (bytes(reason).length == 0) revert EmptyValue();
        p.disputed = true;
        emit DisputeFlagged(id, reason, msg.sender);
    }

    function clearDispute(uint256 id, string calldata resolution) external onlyRegistrar {
        Parcel storage p = _get(id);
        if (!p.disputed) revert NotDisputed();
        p.disputed = false;
        emit DisputeCleared(id, resolution, msg.sender);
    }

    // ----------------------------------------------------------------- owner

    /// @notice The owner offers the parcel to a buyer. A registrar must approve it.
    function proposeTransfer(uint256 id, address to) external {
        Parcel storage p = _get(id);
        if (msg.sender != p.owner) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        if (to == p.owner) revert SelfTransfer();
        if (p.disputed) revert UnderDispute();
        if (p.pendingBuyer != address(0)) revert TransferPending();
        p.pendingBuyer = to;
        emit TransferProposed(id, msg.sender, to);
    }

    function cancelTransfer(uint256 id) external {
        Parcel storage p = _get(id);
        if (msg.sender != p.owner) revert NotOwner();
        if (p.pendingBuyer == address(0)) revert NoPendingTransfer();
        p.pendingBuyer = address(0);
        emit TransferCancelled(id);
    }

    // -------------------------------------------------------------- internal

    function _get(uint256 id) private view returns (Parcel storage p) {
        p = _parcels[id];
        if (p.owner == address(0)) revert UnknownParcel();
    }
}
